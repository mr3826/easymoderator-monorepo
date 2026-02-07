const DeliveryIntegration = require('./delivery-integration.entity');
const PathaoProvider = require('./providers/pathao.provider');
const SteadfastProvider = require('./providers/steadfast.provider');
const deliveryService = require('./delivery.service');
const AppError = require('src/utils/AppError');

/**
 * Delivery Settings Controller
 */
class DeliveryController {
    /**
     * Get delivery settings for the shop
     */
    async getSettings(req, res, next) {
        try {
            const shopId = req.user.shopId;

            const integrations = await DeliveryIntegration.findAll({
                where: { shop_id: shopId },
                attributes: ['id', 'provider', 'is_active', 'is_connected', 'metadata', 'last_validated_at', 'created_at']
            });

            // Build provider list
            const providers = ['pathao', 'steadfast'].map(providerName => {
                const integration = integrations.find(i => i.provider === providerName);
                
                return {
                    provider: providerName,
                    display_name: providerName === 'pathao' ? 'Pathao Courier' : 'Steadfast Courier',
                    is_connected: integration ? integration.is_connected : false,
                    is_active: integration ? integration.is_active : false,
                    metadata: integration ? integration.metadata : {},
                    last_validated_at: integration ? integration.last_validated_at : null,
                    connected_at: integration ? integration.created_at : null
                };
            });

            res.json({
                success: true,
                data: {
                    providers
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Connect a delivery provider
     */
    async connectProvider(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const { provider, credentials, is_sandbox = false, metadata = {} } = req.body;

            // Check if provider already exists
            let integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            // Validate credentials with provider
            let ProviderClass;
            if (provider === 'pathao') {
                ProviderClass = PathaoProvider;
            } else if (provider === 'steadfast') {
                ProviderClass = SteadfastProvider;
            } else {
                throw new AppError('Invalid provider', 400);
            }

            const providerInstance = new ProviderClass(credentials, is_sandbox);
            const validation = await providerInstance.validateCredentials();

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Credential validation failed',
                    error: validation.error
                });
            }

            // For Pathao, store the access and refresh tokens
            let finalCredentials = { ...credentials };
            if (provider === 'pathao' && validation.access_token) {
                finalCredentials.access_token = validation.access_token;
                finalCredentials.refresh_token = validation.refresh_token;
            }

            // Update provider metadata if available
            let finalMetadata = { ...metadata };
            if (provider === 'pathao' && validation.stores) {
                finalMetadata.stores = validation.stores;
                // Set default store if only one exists
                if (validation.stores.length === 1) {
                    finalMetadata.store_id = validation.stores[0].store_id;
                }
            }
            if (provider === 'steadfast' && validation.balance !== undefined) {
                finalMetadata.balance = validation.balance;
            }

            if (integration) {
                // Update existing integration
                integration.credentials = finalCredentials;
                integration.is_connected = true;
                integration.metadata = finalMetadata;
                integration.last_validated_at = new Date();
                await integration.save();
            } else {
                // Create new integration
                integration = await DeliveryIntegration.create({
                    shop_id: shopId,
                    provider,
                    credentials: finalCredentials,
                    is_connected: true,
                    is_active: false, // Merchant needs to activate it
                    metadata: finalMetadata,
                    last_validated_at: new Date()
                });
            }

            res.json({
                success: true,
                message: `${provider === 'pathao' ? 'Pathao' : 'Steadfast'} connected successfully`,
                data: {
                    provider: integration.provider,
                    is_connected: integration.is_connected,
                    is_active: integration.is_active,
                    metadata: integration.metadata
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Disconnect a delivery provider
     */
    async disconnectProvider(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const userId = req.userId;
            const { provider } = req.body;

            const integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            if (!integration) {
                throw new AppError('Provider not found', 404);
            }

            // Deactivate and disconnect
            integration.is_active = false;
            integration.is_connected = false;
            await integration.save();

            // TODO: Log audit event
            // await auditLog({
            //     user_id: userId,
            //     shop_id: shopId,
            //     action: 'delivery_provider_disconnected',
            //     resource_type: 'delivery_integration',
            //     resource_id: integration.id,
            //     old_values: { is_connected: true },
            //     new_values: { is_connected: false }
            // });

            res.json({
                success: true,
                message: `${provider === 'pathao' ? 'Pathao' : 'Steadfast'} disconnected successfully`
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Toggle provider active status
     */
    async toggleProvider(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const { provider, is_active } = req.body;

            const integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            if (!integration) {
                throw new AppError('Provider not found', 404);
            }

            if (!integration.is_connected) {
                throw new AppError('Provider must be connected before activation', 400);
            }

            integration.is_active = is_active;
            await integration.save();

            res.json({
                success: true,
                message: `Provider ${is_active ? 'activated' : 'deactivated'} successfully`,
                data: {
                    provider: integration.provider,
                    is_active: integration.is_active
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Test provider connection
     */
    async testConnection(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const { provider } = req.body;

            const integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            if (!integration || !integration.is_connected) {
                throw new AppError('Provider not connected', 400);
            }

            let ProviderClass;
            if (provider === 'pathao') {
                ProviderClass = PathaoProvider;
            } else if (provider === 'steadfast') {
                ProviderClass = SteadfastProvider;
            } else {
                throw new AppError('Invalid provider', 400);
            }

            const providerInstance = new ProviderClass(integration.credentials);
            const validation = await providerInstance.validateCredentials();

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Connection test failed',
                    error: validation.error
                });
            }

            // Update last validated time
            integration.last_validated_at = new Date();
            await integration.save();

            res.json({
                success: true,
                message: 'Connection test successful',
                data: validation
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get provider stores (Pathao only)
     */
    async getProviderStores(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const { provider } = req.params;

            if (provider !== 'pathao') {
                throw new AppError('Only Pathao supports store management', 400);
            }

            const integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider: 'pathao'
                }
            });

            if (!integration || !integration.is_connected) {
                throw new AppError('Pathao not connected', 400);
            }

            const pathaoInstance = new PathaoProvider(integration.credentials);
            const stores = await pathaoInstance.getStores();

            // Update metadata with latest stores
            integration.metadata = {
                ...integration.metadata,
                stores
            };
            await integration.save();

            res.json({
                success: true,
                data: {
                    stores
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update provider metadata (e.g., selected store)
     */
    async updateMetadata(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const { provider } = req.params;
            const { metadata } = req.body;

            const integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            if (!integration) {
                throw new AppError('Provider not found', 404);
            }

            integration.metadata = {
                ...integration.metadata,
                ...metadata
            };
            await integration.save();

            res.json({
                success: true,
                message: 'Metadata updated successfully',
                data: {
                    metadata: integration.metadata
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new DeliveryController();
