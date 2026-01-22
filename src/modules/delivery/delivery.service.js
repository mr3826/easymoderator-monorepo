const DeliveryIntegration = require('./delivery-integration.entity');
const PathaoProvider = require('./providers/pathao.provider');
const SteadfastProvider = require('./providers/steadfast.provider');
const EventEmitter = require('events');

/**
 * Unified Delivery Service
 * Abstracts provider-specific logic and normalizes responses
 */
class DeliveryService extends EventEmitter {
    constructor() {
        super();
        this.providers = {
            pathao: PathaoProvider,
            steadfast: SteadfastProvider
        };
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

        const ProviderClass = this.providers[provider];
        if (!ProviderClass) {
            throw new Error(`Unknown provider: ${provider}`);
        }

        const credentials = integration.credentials;
        return new ProviderClass(credentials);
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
     * Normalize order payload based on provider
     */
    normalizeOrderPayload(provider, orderData, providerMetadata = {}) {
        if (provider === 'pathao') {
            return {
                store_id: providerMetadata.store_id || orderData.store_id,
                merchant_order_id: orderData.order_number,
                recipient_name: orderData.customer_name,
                recipient_phone: orderData.customer_phone,
                recipient_address: orderData.delivery_address,
                delivery_type: orderData.delivery_type || 48, // 48 = Normal, 12 = On Demand
                item_type: orderData.item_type || 2, // 1 = Document, 2 = Parcel
                special_instruction: orderData.note || '',
                item_quantity: orderData.item_quantity || 1,
                item_weight: orderData.item_weight || 0.5,
                item_description: orderData.item_description || '',
                amount_to_collect: orderData.total || 0
            };
        }

        if (provider === 'steadfast') {
            return {
                invoice: orderData.order_number,
                recipient_name: orderData.customer_name,
                recipient_phone: orderData.customer_phone,
                recipient_address: orderData.delivery_address,
                cod_amount: orderData.total || 0,
                note: orderData.note || '',
                item_description: orderData.item_description || '',
                total_lot: orderData.item_quantity || 1,
                delivery_type: orderData.delivery_type || 0 // 0 = Home, 1 = Point Delivery
            };
        }

        throw new Error(`Unknown provider: ${provider}`);
    }

    /**
     * Normalize order response to internal format
     */
    normalizeOrderResponse(provider, response) {
        const normalized = {
            provider,
            success: true,
            consignment_id: null,
            tracking_code: null,
            status: null,
            delivery_fee: null,
            raw_response: response
        };

        if (provider === 'pathao') {
            normalized.consignment_id = response.consignment_id;
            normalized.tracking_code = response.consignment_id;
            normalized.status = response.order_status;
            normalized.delivery_fee = response.delivery_fee;
        }

        if (provider === 'steadfast') {
            normalized.consignment_id = response.consignment_id;
            normalized.tracking_code = response.tracking_code;
            normalized.status = response.status;
            normalized.invoice = response.invoice;
        }

        return normalized;
    }

    /**
     * Normalize delivery status to internal format
     */
    normalizeDeliveryStatus(provider, status) {
        // Map provider-specific statuses to internal statuses
        const statusMap = {
            pathao: {
                'Pending': 'pending',
                'Picked_Up': 'picked_up',
                'In_Transit': 'in_transit',
                'Delivered': 'delivered',
                'Cancelled': 'cancelled',
                'Returned': 'returned',
                'Hold': 'hold'
            },
            steadfast: {
                'pending': 'pending',
                'in_review': 'in_review',
                'hold': 'hold',
                'delivered_approval_pending': 'delivered_pending',
                'delivered': 'delivered',
                'partial_delivered': 'partial_delivered',
                'cancelled_approval_pending': 'cancelled_pending',
                'cancelled': 'cancelled',
                'unknown': 'unknown'
            }
        };

        const providerMap = statusMap[provider] || {};
        return providerMap[status] || status.toLowerCase();
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
                error: error.message,
                timestamp: new Date()
            });

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
