const DeliveryIntegration = require('./delivery-integration.entity');
const PathaoProvider = require('./providers/pathao.provider');
const { COURIER_REGISTRY } = require('./providers/provider.registry');
const deliveryService = require('./delivery.service');
const { AppError } = require('../../utils/AppError');
const { Shop } = require('../entities');
const { mergeAndSanitizeSettings } = require('../shop/shop-settings.validator');
const { invalidateShopSettingsCaches } = require('../../utils/shop-settings-cache');

const DELIVERY_ZONES = ['inside_dhaka', 'sub_dhaka', 'outside_dhaka'];

const DEFAULT_DELIVERY_SETTINGS = {
    default_delivery_charge: 60,
    cod_enabled: false,
    cod_charge: 0,
    non_refundable: false,
    area_pricing: [
        { zone: 'inside_dhaka', charge: 60, cod_enabled: false },
        { zone: 'sub_dhaka', charge: 80, cod_enabled: false },
        { zone: 'outside_dhaka', charge: 120, cod_enabled: false }
    ],
    weight_tiers: []
};

const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAreaPricing = (areas) => {
    if (!Array.isArray(areas)) return [];

    return areas
        .map((entry) => ({
            zone: entry?.zone,
            charge: toNumber(entry?.charge, 0),
            cod_enabled: Boolean(entry?.cod_enabled)
        }))
        .filter((entry) => DELIVERY_ZONES.includes(entry.zone));
};

const normalizeWeightTiers = (tiers) => {
    if (!Array.isArray(tiers)) return [];

    return tiers
        .map((entry) => ({
            from_kg: toNumber(entry?.from_kg, 0),
            to_kg: toNumber(entry?.to_kg, 0),
            extra_charge: toNumber(entry?.extra_charge, 0)
        }))
        .filter((entry) => Number.isFinite(entry.from_kg) && Number.isFinite(entry.to_kg));
};

const applyDeliveryDefaults = (settings = {}) => {
    const normalizedAreas = normalizeAreaPricing(settings.area_pricing);
    const normalizedTiers = normalizeWeightTiers(settings.weight_tiers);

    return {
        default_delivery_charge: toNumber(settings.default_delivery_charge, DEFAULT_DELIVERY_SETTINGS.default_delivery_charge),
        cod_enabled: settings.cod_enabled ?? DEFAULT_DELIVERY_SETTINGS.cod_enabled,
        cod_charge: toNumber(settings.cod_charge, DEFAULT_DELIVERY_SETTINGS.cod_charge),
        non_refundable: settings.non_refundable ?? DEFAULT_DELIVERY_SETTINGS.non_refundable,
        area_pricing: normalizedAreas.length > 0 ? normalizedAreas : DEFAULT_DELIVERY_SETTINGS.area_pricing,
        weight_tiers: normalizedTiers.length > 0 ? normalizedTiers : DEFAULT_DELIVERY_SETTINGS.weight_tiers
    };
};

const serializeStore = (store) => {
    if (!store || typeof store !== 'object') return null;
    const safe = {};
    for (const key of ['store_id', 'store_name', 'city_id', 'zone_id', 'area_id']) {
        if (store[key] !== undefined) safe[key] = store[key];
    }
    return safe;
};

const serializeProviderMetadata = (metadata = {}) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

    const safe = {};
    for (const key of ['store_id', 'store_name']) {
        if (metadata[key] !== undefined) safe[key] = metadata[key];
    }
    if (Array.isArray(metadata.stores)) {
        safe.stores = metadata.stores.map(serializeStore).filter(Boolean);
    }
    if (Number.isFinite(Number(metadata.balance))) {
        safe.balance = Number(metadata.balance);
    }
    return safe;
};

const serializeProviderValidation = (validation = {}) => {
    const source = validation && typeof validation === 'object' ? validation : {};
    const safe = { valid: source.valid === true };
    if (Array.isArray(source.stores)) {
        safe.stores = source.stores.map(serializeStore).filter(Boolean);
    }
    if (source.balance !== undefined && Number.isFinite(Number(source.balance))) {
        safe.balance = Number(source.balance);
    }
    if (!safe.valid && typeof source.error === 'string') {
        safe.error = source.error;
    }
    return safe;
};

const forwardSafeProviderError = (next, error, message) => {
    if (error instanceof AppError) return next(error);
    return next(new AppError(message, 502));
};

const pickDeliverySettings = (payload = {}) => {
    const allowed = [
        'default_delivery_charge',
        'cod_enabled',
        'cod_charge',
        'non_refundable',
        'area_pricing',
        'weight_tiers'
    ];

    return allowed.reduce((acc, key) => {
        if (payload[key] !== undefined) {
            acc[key] = payload[key];
        }
        return acc;
    }, {});
};

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
                attributes: ['id', 'provider', 'is_active', 'is_connected', 'is_sandbox', 'metadata', 'last_validated_at', 'created_at']
            });

            const shop = await Shop.findByPk(shopId, { attributes: ['id', 'settings'] });
            const deliverySettings = applyDeliveryDefaults(shop?.settings?.delivery || {});

            // Build provider list
            const providers = Object.keys(COURIER_REGISTRY).map(providerName => {
                const integration = integrations.find(i => i.provider === providerName);
                const providerMeta = COURIER_REGISTRY[providerName];
                
                return {
                    provider: providerName,
                    display_name: `${providerMeta.label} Courier`,
                    is_connected: integration ? integration.is_connected : false,
                    is_active: integration ? integration.is_active : false,
                    is_sandbox: integration ? integration.is_sandbox === true : false,
                    metadata: integration ? serializeProviderMetadata(integration.metadata) : {},
                    last_validated_at: integration ? integration.last_validated_at : null,
                    connected_at: integration ? integration.created_at : null
                };
            });

            res.json({
                success: true,
                data: {
                    providers,
                    settings: deliverySettings
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update delivery settings for the shop
     */
    async updateSettings(req, res, next) {
        try {
            const shopId = req.user.shopId;
            const shop = await Shop.findByPk(shopId);

            if (!shop) {
                throw new AppError('Shop not found', 404);
            }

            const existingSettings = shop.settings || {};
            const existingDelivery = existingSettings.delivery || {};
            const incoming = pickDeliverySettings(req.body || {});
            const normalizedDelivery = applyDeliveryDefaults({
                ...existingDelivery,
                ...incoming
            });
            const mergedSettings = mergeAndSanitizeSettings(existingSettings, {
                delivery: {
                    ...existingDelivery,
                    ...normalizedDelivery
                }
            });
            const merged = mergedSettings.delivery;

            await shop.update({
                settings: mergedSettings
            });
            await invalidateShopSettingsCaches(shopId);

            res.json({
                success: true,
                data: merged
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
            const isSandbox = is_sandbox === true;

            // Check if provider already exists
            let integration = await DeliveryIntegration.findOne({
                where: {
                    shop_id: shopId,
                    provider
                }
            });

            // Validate credentials with provider
            const providerMeta = COURIER_REGISTRY[provider];
            if (!providerMeta) {
                throw new AppError('Invalid provider', 400);
            }
            const ProviderClass = providerMeta.Provider;

            const providerInstance = new ProviderClass(credentials, isSandbox);
            const validation = await providerInstance.validateCredentials();
            const safeValidation = serializeProviderValidation(validation);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Credential validation failed',
                    error: 'Credential validation failed'
                });
            }

            // For Pathao, store the access and refresh tokens
            let finalCredentials = { ...credentials };
            if (provider === 'pathao' && validation.access_token) {
                finalCredentials.access_token = validation.access_token;
                finalCredentials.refresh_token = validation.refresh_token;
            }

            // Update provider metadata if available
            let finalMetadata = serializeProviderMetadata(metadata);
            if (provider === 'pathao' && safeValidation.stores) {
                finalMetadata.stores = safeValidation.stores;
                // Set default store if only one exists
                if (safeValidation.stores.length === 1) {
                    finalMetadata.store_id = safeValidation.stores[0].store_id;
                }
            }
            if (provider === 'steadfast' && safeValidation.balance !== undefined) {
                finalMetadata.balance = safeValidation.balance;
            }

            if (integration) {
                // Update existing integration
                integration.credentials = finalCredentials;
                integration.is_connected = true;
                integration.is_sandbox = isSandbox;
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
                    is_sandbox: isSandbox,
                    metadata: finalMetadata,
                    last_validated_at: new Date()
                });
            }

            res.json({
                success: true,
                message: `${providerMeta.label} connected successfully`,
                data: {
                    provider: integration.provider,
                    is_connected: integration.is_connected,
                    is_active: integration.is_active,
                    is_sandbox: integration.is_sandbox === true,
                    metadata: serializeProviderMetadata(integration.metadata)
                }
            });
        } catch (error) {
            forwardSafeProviderError(next, error, 'Delivery provider connection failed');
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

            res.json({
                success: true,
                message: `${COURIER_REGISTRY[provider]?.label || provider} disconnected successfully`
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
            const { provider } = req.body;
            const isActive = req.body.is_active ?? req.body.isActive;

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

            integration.is_active = isActive;
            await integration.save();

            res.json({
                success: true,
                message: `Provider ${isActive ? 'activated' : 'deactivated'} successfully`,
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

            const providerMeta = COURIER_REGISTRY[provider];
            if (!providerMeta) {
                throw new AppError('Invalid provider', 400);
            }
            const ProviderClass = providerMeta.Provider;

            const providerInstance = new ProviderClass(
                integration.credentials,
                integration.is_sandbox === true
            );
            const validation = await providerInstance.validateCredentials();
            const safeValidation = serializeProviderValidation(validation);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Connection test failed',
                    error: 'Connection test failed'
                });
            }

            // Update last validated time
            integration.last_validated_at = new Date();
            await integration.save();

            res.json({
                success: true,
                message: 'Connection test successful',
                data: safeValidation
            });
        } catch (error) {
            forwardSafeProviderError(next, error, 'Delivery provider test failed');
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

            const pathaoInstance = new PathaoProvider(
                integration.credentials,
                integration.is_sandbox === true
            );
            const stores = await pathaoInstance.getStores();
            const safeStores = (Array.isArray(stores) ? stores : []).map(serializeStore).filter(Boolean);

            // Update metadata with latest stores
            integration.metadata = {
                ...serializeProviderMetadata(integration.metadata),
                stores: safeStores
            };
            await integration.save();

            res.json({
                success: true,
                data: {
                    stores: safeStores
                }
            });
        } catch (error) {
            forwardSafeProviderError(next, error, 'Delivery provider store lookup failed');
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

            integration.metadata = serializeProviderMetadata({
                ...integration.metadata,
                ...metadata
            });
            await integration.save();

            res.json({
                success: true,
                message: 'Metadata updated successfully',
                data: {
                    metadata: serializeProviderMetadata(integration.metadata)
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new DeliveryController();
