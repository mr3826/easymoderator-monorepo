'use strict';

const { DeliveryIntegration, ShopPickupLocation } = require('../entities');
const { AppError } = require('../../utils/AppError');
const pickupLocationService = require('./pickup-location.service');

const isPlainObject = (value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isTrue = (value) => value === true || value === 1 || value === 'true';
const hasValue = (value) => value !== undefined
    && value !== null
    && (typeof value !== 'string' || value.trim() !== '');

const metadataFor = (integration) => {
    if (isPlainObject(integration?.metadata)) return integration.metadata;
    if (typeof integration?.metadata === 'string') {
        try { return JSON.parse(integration.metadata); } catch (_) { return {}; }
    }
    return {};
};

const getProviderStoreId = (integration) => {
    const metadata = metadataFor(integration);
    const value = integration?.provider_store_id
        ?? integration?.pickup_store_id
        ?? metadata.pickup_store_id
        ?? metadata.store_id;
    return value === undefined || value === null || value === '' ? null : String(value);
};

const getPickupLocationId = (integration) => {
    const value = integration?.pickup_location_id ?? metadataFor(integration).pickup_location_id;
    return value === undefined || value === null || value === '' ? null : String(value);
};

const getProviderStores = (integration) => {
    const stores = metadataFor(integration).stores;
    return Array.isArray(stores) ? stores.filter((store) => isPlainObject(store)) : [];
};

const getProviderPickupMetadata = (integration) => {
    let source = integration?.provider_pickup_meta ?? metadataFor(integration).provider_pickup_meta;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch (_) { source = {}; }
    }
    if (!isPlainObject(source)) return {};
    const safe = {};
    for (const key of ['city_id', 'zone_id', 'area_id', 'delivery_area_id', 'pickup_store_id', 'provider_store_id']) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') safe[key] = source[key];
    }
    return safe;
};

const hasProviderCredentials = (integration, provider) => {
    const credentials = integration?.credentials;
    if (!isPlainObject(credentials)) return false;
    if (provider === 'pathao') {
        return typeof credentials.client_id === 'string'
            && hasValue(credentials.client_id)
            && (hasValue(credentials.access_token) || hasValue(credentials.refresh_token)
                || (hasValue(credentials.client_secret)
                    && hasValue(credentials.username)
                    && hasValue(credentials.password)));
    }
    if (provider === 'steadfast') {
        return hasValue(credentials.api_key) && hasValue(credentials.secret_key);
    }
    if (provider === 'redx') return hasValue(credentials.api_key);
    return Object.keys(credentials).length > 0;
};

const loadLocations = async (shopId, provider) => {
    if (!ShopPickupLocation || typeof ShopPickupLocation.findAll !== 'function') return [];
    const locations = await ShopPickupLocation.findAll({
        where: { shop_id: shopId, is_active: true },
        order: [['is_default', 'DESC'], ['created_at', 'ASC'], ['id', 'ASC']],
    });
    return locations.filter((location) => (
        !provider
        || location.provider === 'manual'
        || location.provider === provider
    ));
};

const readinessForIntegration = async (
    shopId,
    integration,
    locations = [],
    requestedProvider = null,
    { requireActive = true } = {},
) => {
    const provider = integration?.provider || requestedProvider || null;
    const connected = integration?.is_connected === true;
    const active = integration?.is_active === true;
    const credentialsConfigured = hasProviderCredentials(integration, provider);
    const stores = getProviderStores(integration);
    const providerStoreId = getProviderStoreId(integration);
    const pickupLocationId = getPickupLocationId(integration);
    const selectedLocation = pickupLocationId
        ? locations.find((location) => String(location.id) === pickupLocationId)
        : null;
    const matchingProviderLocation = locations.find((location) => (
        location.provider === provider && providerStoreId
        && String(location.provider_store_id) === providerStoreId
    ));
    const providerPickupMeta = getProviderPickupMetadata(integration);
    const selectedLocationMatchesStore = selectedLocation && (
        selectedLocation.provider === 'manual'
        || !providerStoreId
        || !selectedLocation.provider_store_id
        || String(selectedLocation.provider_store_id) === providerStoreId
    );
    const pickupEnabled = integration?.pickup_enabled
        ?? metadataFor(integration).pickup_enabled
        ?? Boolean(selectedLocation || matchingProviderLocation);
    const shopScopedPickup = Boolean(matchingProviderLocation || selectedLocationMatchesStore);
    const pickupConfigured = Boolean(
        pickupEnabled
        && shopScopedPickup
    );

    const missing = [];
    if (!integration) missing.push('provider_not_connected');
    else {
        if (!connected) missing.push('provider_not_connected');
        if (requireActive && !active) missing.push('provider_not_active');
        if (!credentialsConfigured) missing.push('provider_credentials_unavailable');
        if (provider === 'pathao' && stores.length === 0 && !shopScopedPickup) {
            missing.push('provider_store_not_synced');
        }
        if (provider === 'redx' && !providerStoreId && !matchingProviderLocation) {
            missing.push('provider_store_not_configured');
        }
        const pickupFieldSources = [providerPickupMeta, selectedLocation, matchingProviderLocation, metadataFor(integration)];
        const pickupField = (...keys) => pickupFieldSources.find((source) => (
            isPlainObject(source)
            && keys.some((key) => hasValue(source[key]))
        ));
        const requiredPickupFields = provider === 'pathao'
            ? [
                { name: 'pickup_city_id', keys: ['city_id'] },
                { name: 'pickup_zone_id', keys: ['zone_id'] },
                { name: 'pickup_area_id', keys: ['area_id'] },
            ]
            : provider === 'redx'
                ? [{ name: 'pickup_area_id', keys: ['area_id', 'delivery_area_id'] }]
                : [];
        for (const field of requiredPickupFields) {
            if (!pickupField(...field.keys)) missing.push(field.name);
        }
        if (!pickupEnabled) missing.push('pickup_not_enabled');
        if (!pickupConfigured) missing.push('pickup_location_not_configured');
    }

    const pickupSummary = selectedLocation || matchingProviderLocation
        ? pickupLocationService.serializePickupLocation(selectedLocation || matchingProviderLocation)
        : null;

    return {
        provider,
        ready: missing.length === 0,
        connected,
        active,
        credentials_configured: credentialsConfigured,
        provider_store_id: providerStoreId,
        provider_store_count: stores.length,
        pickup_location_id: selectedLocation?.id || pickupLocationId,
        pickup_location_configured: pickupConfigured,
        pickup_enabled: pickupEnabled,
        pickup_summary: pickupSummary,
        provider_pickup_meta: providerPickupMeta,
        pickup_locations_count: locations.length,
        missing,
        missing_fields: missing,
        status: missing.length === 0 ? (active ? 'ACTIVE' : 'READY') : 'SETUP_INCOMPLETE',
    };
};

const getReadiness = async (shopId, provider = null, { requireActive = true } = {}) => {
    if (!shopId) throw new AppError('Shop ID is required', 400, 'VALIDATION_ERROR');

    const integrations = provider
        ? [await DeliveryIntegration.findOne({ where: { shop_id: shopId, provider } })].filter(Boolean)
        : (typeof DeliveryIntegration.findAll === 'function'
            ? await DeliveryIntegration.findAll({ where: { shop_id: shopId } })
            : []);
    const locations = await loadLocations(shopId, provider);

    if (provider) {
        return readinessForIntegration(shopId, integrations[0] || null, locations, provider, { requireActive });
    }

    const providers = await Promise.all(integrations.map((integration) => (
        readinessForIntegration(shopId, integration, locations, null, { requireActive })
    )));
    const selected = providers.find((item) => item.ready && item.active && item.connected)
        || providers.find((item) => item.active && item.connected)
        || providers[0]
        || await readinessForIntegration(shopId, null, locations, null, { requireActive });

    return {
        ...selected,
        providers,
    };
};

const assertReady = async (shopId, provider = null, options = {}) => {
    const readiness = await getReadiness(shopId, provider, options);
    if (!readiness.ready) {
        throw new AppError(
            'Courier is not ready for activation',
            409,
            'DELIVERY_NOT_READY',
            { provider: readiness.provider, missing: readiness.missing },
        );
    }
    return readiness;
};

module.exports = {
    getReadiness,
    getCourierReadiness: getReadiness,
    evaluateReadiness: getReadiness,
    assertReady,
    _private: {
        getProviderStoreId,
        getPickupLocationId,
        readinessForIntegration,
    },
};
