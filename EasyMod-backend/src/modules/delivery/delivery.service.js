const DeliveryIntegration = require('./delivery-integration.entity');
const { COURIER_REGISTRY } = require('./providers/provider.registry');
const EventEmitter = require('events');

/**
 * Unified Delivery Service
 * Abstracts provider-specific logic and normalizes responses
 */
class DeliveryService extends EventEmitter {
    constructor() {
        super();
        this.providers = COURIER_REGISTRY;
    }

    /**
     * Get provider instance for a shop
     */
    async getProviderInstance(shopId, provider) {
        const integration = await DeliveryIntegration.findOne({
            where: {
                shop_id: shopId,
                provider: provider,
                is_active: true,
                is_connected: true
            }
        });

        if (!integration) {
            throw new Error(`No active ${provider} integration found for this shop`);
        }

        const entry = this.providers[provider];
        if (!entry) {
            throw new Error(`Unknown provider: ${provider}`);
        }

        const credentials = integration.credentials;
        return new entry.Provider(credentials);
    }

    /**
     * Get active delivery provider for a shop
     */
    async getActiveProvider(shopId) {
        const integration = await DeliveryIntegration.findOne({
            where: {
                shop_id: shopId,
                is_active: true,
                is_connected: true
            },
            order: [['updated_at', 'DESC']]
        });

        if (!integration) {
            return null;
        }

        return {
            provider: integration.provider,
            instance: await this.getProviderInstance(shopId, integration.provider),
            metadata: integration.metadata
        };
    }

    /**
     * Normalize order payload based on provider — delegates to registry
     */
    normalizeOrderPayload(provider, orderData, providerMetadata = {}) {
        const entry = this.providers[provider];
        if (!entry) throw new Error(`Unknown provider: ${provider}`);
        return entry.normalizePayload(orderData, providerMetadata);
    }

    /**
     * Normalize order response to internal format — delegates to registry
     */
    normalizeOrderResponse(provider, response) {
        const entry = this.providers[provider];
        if (!entry) throw new Error(`Unknown provider: ${provider}`);
        const fields = entry.normalizeResponse(response);
        return {
            provider,
            success: true,
            consignment_id: null,
            tracking_code: null,
            status: null,
            delivery_fee: null,
            raw_response: response,
            ...fields
        };
    }

    /**
     * Normalize delivery status to internal format — delegates to registry status map
     */
    normalizeDeliveryStatus(provider, status) {
        const entry = this.providers[provider];
        const map = entry ? entry.statusMap : {};
        return map[status] || status.toLowerCase();
    }

    /**
     * Create delivery order
     */
    async createDeliveryOrder(shopId, orderData, preferredProvider = null) {
        try {
            let provider = preferredProvider;
            let providerInstance;
            let metadata = {};

            if (!provider) {
                // Get active provider
                const activeProvider = await this.getActiveProvider(shopId);
                if (!activeProvider) {
                    throw new Error('No active delivery provider configured');
                }
                provider = activeProvider.provider;
                providerInstance = activeProvider.instance;
                metadata = activeProvider.metadata;
            } else {
                providerInstance = await this.getProviderInstance(shopId, provider);
                const integration = await DeliveryIntegration.findOne({
                    where: { shop_id: shopId, provider }
                });
                metadata = integration?.metadata || {};
            }

            // Normalize payload
            const normalizedPayload = this.normalizeOrderPayload(provider, orderData, metadata);

            // Create order with provider
            const response = await providerInstance.createOrder(normalizedPayload);

            // Normalize response
            const normalizedResponse = this.normalizeOrderResponse(provider, response);

            // Emit event for n8n integration
            this.emit('order_dispatched', {
                shop_id: shopId,
                order_number: orderData.order_number,
                provider,
                consignment_id: normalizedResponse.consignment_id,
                tracking_code: normalizedResponse.tracking_code,
                status: normalizedResponse.status,
                timestamp: new Date()
            });

            return normalizedResponse;
        } catch (error) {
            // Emit failure event
            this.emit('order_dispatch_failed', {
                shop_id: shopId,
                order_number: orderData.order_number,
                provider: preferredProvider,
                error: error.message,
                timestamp: new Date()
            });

            try {
                const merchantNotificationService = require('../notification/merchant-notification.service');
                const { NOTIFICATION_EVENTS } = require('../notification/notification-events');
                merchantNotificationService.notifyShop(
                    shopId,
                    NOTIFICATION_EVENTS.COURIER_BOOKING_FAILED,
                    {
                        orderId: orderData.id,
                        orderNumber: orderData.order_number,
                        provider: preferredProvider,
                        error: error.message
                    },
                    { dedupeKey: `${orderData.id || orderData.order_number || Date.now()}:${preferredProvider || 'active'}` }
                ).catch(() => {});
            } catch (_) { /* delivery failure is already being thrown */ }

            throw error;
        }
    }

    /**
     * Get delivery order status
     */
    async getDeliveryStatus(shopId, provider, reference) {
        try {
            const providerInstance = await this.getProviderInstance(shopId, provider);
            const statusResponse = await providerInstance.getOrderStatus(reference);

            const normalizedStatus = this.normalizeDeliveryStatus(
                provider,
                statusResponse.order_status || statusResponse.delivery_status
            );

            return {
                provider,
                reference,
                status: normalizedStatus,
                raw_status: statusResponse.order_status || statusResponse.delivery_status,
                updated_at: statusResponse.updated_at || new Date(),
                raw_response: statusResponse
            };
        } catch (error) {
            throw new Error(`Failed to get delivery status: ${error.message}`);
        }
    }

    /**
     * Update delivery status and emit events
     */
    async updateDeliveryStatus(shopId, orderNumber, provider, reference) {
        try {
            const statusData = await this.getDeliveryStatus(shopId, provider, reference);

            // Emit status change event for n8n
            this.emit('delivery_status_updated', {
                shop_id: shopId,
                order_number: orderNumber,
                provider,
                status: statusData.status,
                raw_status: statusData.raw_status,
                timestamp: new Date()
            });

            // Emit specific events based on status
            if (statusData.status === 'delivered') {
                this.emit('order_delivered', {
                    shop_id: shopId,
                    order_number: orderNumber,
                    provider,
                    timestamp: new Date()
                });
            }

            if (statusData.status.includes('cancelled') || statusData.status === 'returned') {
                this.emit('order_failed', {
                    shop_id: shopId,
                    order_number: orderNumber,
                    provider,
                    status: statusData.status,
                    timestamp: new Date()
                });
            }

            return statusData;
        } catch (error) {
            throw new Error(`Failed to update delivery status: ${error.message}`);
        }
    }

    /**
     * Calculate delivery price
     */
    async calculateDeliveryPrice(shopId, provider, pricePayload) {
        try {
            const providerInstance = await this.getProviderInstance(shopId, provider);
            
            if (typeof providerInstance.calculatePrice !== 'function') {
                return null; // Provider doesn't support price calculation
            }

            return await providerInstance.calculatePrice(pricePayload);
        } catch (error) {
            throw new Error(`Failed to calculate delivery price: ${error.message}`);
        }
    }
}

// Export singleton instance
module.exports = new DeliveryService();
