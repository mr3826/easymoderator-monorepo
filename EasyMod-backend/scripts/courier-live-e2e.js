#!/usr/bin/env node
'use strict';

/**
 * COURIER LIVE E2E
 *
 * This runner is deliberately opt-in. It talks to Pathao and RedX sandbox
 * hosts, and it can create real sandbox parcels and a real courier dispatch
 * for a sacrificial order. It never migrates, syncs, seeds, truncates, or
 * prints credentials.
 *
 * Required infrastructure:
 *   DATABASE_URL, REDIS_URL, DELIVERY_ENCRYPTION_KEY
 *
 * Required safety acknowledgement:
 *   COURIER_LIVE_CONFIRM=YES
 *
 * Database fixtures:
 *   COURIER_LIVE_SHOP_ID       sandbox shop used by activation/default checks
 *   COURIER_LIVE_ORDER_ID      fresh sacrificial order for AI dispatch
 *
 * Provider credentials and payload selectors are environment-controlled:
 *   PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD
 *   REDX_API_KEY
 *   COURIER_LIVE_PATHAO_STORE_ID, COURIER_LIVE_PATHAO_CITY_ID,
 *   COURIER_LIVE_PATHAO_ZONE_ID, COURIER_LIVE_PATHAO_AREA_ID
 *   COURIER_LIVE_REDX_PICKUP_STORE_ID, COURIER_LIVE_REDX_AREA_ID
 *   COURIER_LIVE_RECIPIENT_NAME, COURIER_LIVE_RECIPIENT_PHONE,
 *   COURIER_LIVE_RECIPIENT_ADDRESS, COURIER_LIVE_COD_AMOUNT,
 *   COURIER_LIVE_WEIGHT_KG
 */

require('module-alias/register');
require('dotenv').config();

const { Op } = require('sequelize');

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

class SkipStep extends Error {}
class Ambiguous extends Error {}

const value = (name) => {
    const raw = process.env[name];
    return typeof raw === 'string' ? raw.trim() : '';
};

const runId = () => value('COURIER_LIVE_RUN_ID')
    || `COURIER-E2E-${Date.now().toString(36).toUpperCase()}`;

const line = (text = '') => process.stdout.write(`${text}\n`);
const rule = () => line('-'.repeat(72));
const report = (label, status, detail = '') => {
    line(`  [${status}] ${label}${detail ? ` - ${detail}` : ''}`);
};

const safeErrorDetail = (error) => {
    const code = error?.code || error?.name || 'ERROR';
    const status = error?.status ?? error?.statusCode ?? error?.response?.status;
    return status ? `${code} status=${status}` : String(code);
};

const asList = (valueToRead, keys = []) => {
    if (Array.isArray(valueToRead)) return valueToRead;
    if (!valueToRead || typeof valueToRead !== 'object') return [];
    for (const key of keys) {
        if (Array.isArray(valueToRead[key])) return valueToRead[key];
    }
    if (valueToRead.data && valueToRead.data !== valueToRead) {
        return asList(valueToRead.data, keys);
    }
    return [];
};

const itemId = (item, keys) => {
    if (!item || typeof item !== 'object') return null;
    for (const key of keys) {
        if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
            return String(item[key]);
        }
    }
    return null;
};

const selectOne = (items, override, keys, label, overrideName) => {
    if (!items.length) throw new Error(`${label} returned no records`);
    if (override) {
        const selected = items.find((item) => itemId(item, keys) === String(override));
        if (!selected) throw new Ambiguous(`${overrideName} did not match a returned ${label}`);
        return selected;
    }
    if (items.length !== 1) {
        throw new Ambiguous(`${label} returned ${items.length} records; set ${overrideName}`);
    }
    return items[0];
};

const numericOr = (raw, fallback) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const isTrue = (raw) => raw === true || raw === 1 || raw === 'true';

let runtime = null;
const loadRuntime = () => {
    if (!runtime) {
        const { sequelize } = require('../src/utils/database/database-setup');
        const {
            DeliveryIntegration,
            ShopPickupLocation,
            Order,
            CourierDispatch,
            Shop,
        } = require('../src/modules/entities');
        runtime = {
            sequelize,
            DeliveryIntegration,
            ShopPickupLocation,
            Order,
            CourierDispatch,
            Shop,
        };
    }
    return runtime;
};

const closeRuntime = async () => {
    try {
        if (runtime?.sequelize) await runtime.sequelize.close();
    } catch (_) {
        // Cleanup is best effort after a failed live run.
    }
    try {
        const redisClientModule = require.resolve('../src/utils/redis-client');
        if (require.cache[redisClientModule]) {
            const { closeRedis } = require(redisClientModule);
            if (typeof closeRedis === 'function') await closeRedis();
        }
    } catch (_) {
        // Cleanup is best effort after a failed live run.
    }
    try {
        const redisModule = require.resolve('../src/config/redis');
        if (require.cache[redisModule]) {
            const redis = require(redisModule);
            if (typeof redis.closeAllRedis === 'function') await redis.closeAllRedis();
        }
    } catch (_) {
        // The module may not have been loaded if preflight stopped early.
    }
};

const requireInputs = (names) => names.filter((name) => !value(name));

const pathaoCredentials = () => ({
    client_id: value('PATHAO_CLIENT_ID'),
    client_secret: value('PATHAO_CLIENT_SECRET'),
    username: value('PATHAO_USERNAME') || value('PATHAO_USER'),
    password: value('PATHAO_PASSWORD'),
});

const redxApiKey = () => value('REDX_API_KEY')
    || value('REDX_API_ACCESS_TOKEN')
    || value('REDX_ACCESS_TOKEN');

const recipient = () => ({
    name: value('COURIER_LIVE_RECIPIENT_NAME') || 'Courier Sandbox Customer',
    phone: value('COURIER_LIVE_RECIPIENT_PHONE'),
    address: value('COURIER_LIVE_RECIPIENT_ADDRESS'),
    codAmount: numericOr(value('COURIER_LIVE_COD_AMOUNT'), 0),
    weightKg: numericOr(value('COURIER_LIVE_WEIGHT_KG'), 0.5),
});

const runPathaoSandbox = async () => {
    const missing = requireInputs([
        'PATHAO_CLIENT_ID',
        'PATHAO_CLIENT_SECRET',
        'PATHAO_PASSWORD',
        'COURIER_LIVE_PATHAO_CITY_ID',
        'COURIER_LIVE_PATHAO_ZONE_ID',
        'COURIER_LIVE_PATHAO_AREA_ID',
        'COURIER_LIVE_RECIPIENT_PHONE',
        'COURIER_LIVE_RECIPIENT_ADDRESS',
    ]);
    if (!value('PATHAO_USERNAME') && !value('PATHAO_USER')) missing.push('PATHAO_USERNAME');
    if (missing.length) throw new SkipStep(`missing ${missing.join(', ')}`);

    const PathaoProvider = require('../src/modules/delivery/providers/pathao.provider');
    const provider = new PathaoProvider(pathaoCredentials(), true);
    const token = await provider.issueToken();
    if (!token?.access_token) throw new Error('Pathao authentication returned no access token');

    const stores = asList(await provider.getStores(), ['stores', 'data']);
    const store = selectOne(
        stores,
        value('COURIER_LIVE_PATHAO_STORE_ID'),
        ['store_id', 'id', 'storeId'],
        'Pathao pickup stores',
        'COURIER_LIVE_PATHAO_STORE_ID',
    );
    const storeId = itemId(store, ['store_id', 'id', 'storeId']);
    const customer = recipient();
    const cityId = value('COURIER_LIVE_PATHAO_CITY_ID');
    const zoneId = value('COURIER_LIVE_PATHAO_ZONE_ID');
    const areaId = value('COURIER_LIVE_PATHAO_AREA_ID');
    const orderData = {
        order_number: `${runId()}-PATHAO`,
        customer_name: customer.name,
        customer_phone: customer.phone,
        delivery_address: customer.address,
        total: customer.codAmount,
        item_weight: customer.weightKg,
        item_quantity: 1,
        item_description: 'EasyMod courier sandbox verification',
        recipient_city: cityId,
        recipient_zone: zoneId,
        recipient_area: areaId,
    };
    const metadata = { provider_store_id: storeId };
    const price = await provider.calculatePrice({
        store_id: storeId,
        item_type: 2,
        delivery_type: 48,
        item_weight: customer.weightKg,
        recipient_city: cityId,
        recipient_zone: zoneId,
        recipient_area: areaId,
        amount_to_collect: customer.codAmount,
    });
    if (!price || typeof price !== 'object') throw new Error('Pathao price quote returned no object');

    const created = await provider.createOrder(provider.normalizePayload(orderData, metadata));
    const consignmentId = created?.consignment_id || created?.tracking_code;
    if (!consignmentId) throw new Error('Pathao shipment returned no consignment ID');
    const tracked = await provider.getOrderStatus(consignmentId);
    if (!tracked || typeof tracked !== 'object') throw new Error('Pathao tracking returned no object');

    return `authenticated; stores=${stores.length}; quote=returned; tracking=returned`;
};

const runRedxSandbox = async () => {
    const missing = requireInputs([
        'COURIER_LIVE_REDX_AREA_ID',
        'COURIER_LIVE_REDX_PICKUP_STORE_ID',
        'COURIER_LIVE_RECIPIENT_PHONE',
        'COURIER_LIVE_RECIPIENT_ADDRESS',
    ]);
    if (!redxApiKey()) missing.push('REDX_API_KEY');
    if (missing.length) throw new SkipStep(`missing ${missing.join(', ')}`);

    const RedXProvider = require('../src/modules/delivery/providers/redx.provider');
    const provider = new RedXProvider({ api_key: redxApiKey() }, true);
    const areas = asList(await provider.listAreas(), ['areas', 'data']);
    const area = selectOne(
        areas,
        value('COURIER_LIVE_REDX_AREA_ID'),
        ['id', 'area_id', 'areaId'],
        'RedX delivery areas',
        'COURIER_LIVE_REDX_AREA_ID',
    );
    const areaId = itemId(area, ['id', 'area_id', 'areaId']);
    const stores = asList(await provider.listPickupStores(), ['stores', 'pickup_stores', 'data']);
    const store = selectOne(
        stores,
        value('COURIER_LIVE_REDX_PICKUP_STORE_ID'),
        ['store_id', 'id', 'pickup_store_id', 'storeId'],
        'RedX pickup stores',
        'COURIER_LIVE_REDX_PICKUP_STORE_ID',
    );
    const storeId = itemId(store, ['store_id', 'id', 'pickup_store_id', 'storeId']);
    const customer = recipient();
    const payload = {
        customer_name: customer.name,
        customer_phone: customer.phone,
        delivery_area_id: areaId,
        customer_address: customer.address,
        merchant_invoice_id: `${runId()}-REDX`,
        cash_collection_amount: customer.codAmount,
        parcel_weight: Math.max(1, Math.round(customer.weightKg * 1000)),
        pickup_store_id: storeId,
        instruction: 'EasyMod courier sandbox verification',
    };
    const charge = await provider.calculatePrice({
        delivery_area_id: areaId,
        pickup_store_id: storeId,
        cash_collection_amount: customer.codAmount,
        parcel_weight: payload.parcel_weight,
    });
    if (charge === undefined || charge === null) throw new Error('RedX delivery charge returned no value');

    const created = await provider.createOrder(payload);
    const trackingId = created?.tracking_code || created?.consignment_id;
    if (!trackingId) throw new Error('RedX parcel returned no tracking ID');
    const tracked = await provider.getOrderStatus(trackingId);
    if (!tracked || typeof tracked !== 'object') throw new Error('RedX tracking returned no object');

    return `areas=${areas.length}; stores=${stores.length}; charge=returned; tracking=returned`;
};

const getSandboxIntegration = async (shopId, provider) => {
    const { DeliveryIntegration } = loadRuntime();
    const integration = await DeliveryIntegration.findOne({
        where: { shop_id: shopId, provider, is_sandbox: true },
    });
    if (!integration) throw new SkipStep(`no sandbox ${provider} integration for the selected shop`);
    return integration;
};

const runActivationGate = async (shopId) => {
    const provider = value('COURIER_LIVE_GATE_PROVIDER') || 'pathao';
    const integration = await getSandboxIntegration(shopId, provider);
    const readinessService = require('../src/modules/delivery/courier-readiness.service');
    const readiness = await readinessService.getReadiness(shopId, provider);
    if (readiness.ready) {
        throw new SkipStep('selected sandbox integration is already ready; no safe incomplete fixture exists');
    }
    if (!readiness.missing.some((item) => /pickup_(not_enabled|location_not_configured)/.test(item))) {
        throw new SkipStep('selected sandbox integration is incomplete for a non-pickup reason');
    }

    try {
        await readinessService.assertReady(shopId, provider);
        throw new Error('readiness assertion unexpectedly succeeded');
    } catch (error) {
        if (error?.code !== 'DELIVERY_NOT_READY' || error?.status !== 409) throw error;
        const missing = Array.isArray(error.details?.missing) ? error.details.missing : [];
        if (!missing.length) throw new Error('activation rejection omitted its missing receipt');
        return `provider=${provider}; missing=${missing.join(',')}; sandbox=${isTrue(integration.is_sandbox)}`;
    }
};

const readActiveSandboxIntegrations = async (shopId) => {
    const { DeliveryIntegration } = loadRuntime();
    return DeliveryIntegration.findAll({
        where: {
            shop_id: shopId,
            provider: { [Op.in]: ['pathao', 'redx'] },
            is_sandbox: true,
            is_connected: true,
            is_active: true,
        },
    });
};

const defaultProviders = (integrations) => integrations
    .filter((integration) => isTrue(integration.is_ai_default))
    .map((integration) => integration.provider);

const runAiDefaultSwitch = async (shopId) => {
    const deliveryService = require('../src/modules/delivery/delivery.service');
    const readinessService = require('../src/modules/delivery/courier-readiness.service');
    const integrations = await readActiveSandboxIntegrations(shopId);
    const ready = [];
    for (const integration of integrations) {
        const readiness = await readinessService.getReadiness(shopId, integration.provider);
        if (readiness.ready) ready.push(integration.provider);
    }
    if (ready.length < 2 || !ready.includes('pathao') || !ready.includes('redx')) {
        throw new SkipStep('both active sandbox providers must be ready before switching AI defaults');
    }

    const original = defaultProviders(integrations)[0] || null;
    const switched = [];
    try {
        for (const provider of ['pathao', 'redx']) {
            await deliveryService.setAiDefaultProvider(shopId, provider, true);
            const fresh = await readActiveSandboxIntegrations(shopId);
            const defaults = defaultProviders(fresh);
            if (defaults.length !== 1 || defaults[0] !== provider) {
                throw new Error(`AI default switch produced ${defaults.length} defaults`);
            }
            switched.push(provider);
        }
    } finally {
        const fresh = await readActiveSandboxIntegrations(shopId);
        const current = defaultProviders(fresh)[0];
        if (original && ready.includes(original)) {
            await deliveryService.setAiDefaultProvider(shopId, original, true);
        } else if (current) {
            await deliveryService.setAiDefaultProvider(shopId, current, false);
        }
    }

    return `switched=${switched.join(',')}; exactly_one_after_each=true; restored=${original || 'none'}`;
};

const runAiDispatchIsolation = async (shopId) => {
    const { Order, CourierDispatch } = loadRuntime();
    const orderId = value('COURIER_LIVE_ORDER_ID');
    if (!orderId) throw new SkipStep('COURIER_LIVE_ORDER_ID is not set');
    const order = await Order.findOne({ where: { id: orderId, shop_id: shopId } });
    if (!order) throw new SkipStep('selected sacrificial order was not found for the selected shop');
    if (order.delivery_consignment_id || order.delivery_tracking_code) {
        throw new SkipStep('selected order already has a delivery reference; use a fresh sacrificial order');
    }

    const existingDispatches = await CourierDispatch.findAll({ where: { shop_id: shopId, order_id: order.id } });
    if (existingDispatches.length) throw new SkipStep('selected order already has courier dispatch history');

    const deliveryService = require('../src/modules/delivery/delivery.service');
    const readinessService = require('../src/modules/delivery/courier-readiness.service');
    const active = await readActiveSandboxIntegrations(shopId);
    const preferred = value('COURIER_LIVE_AI_PROVIDER');
    const candidate = preferred
        ? active.find((integration) => integration.provider === preferred)
        : active.find((integration) => integration.provider === 'pathao') || active[0];
    if (!candidate) throw new SkipStep('no active sandbox integration is available for AI dispatch');
    const readiness = await readinessService.getReadiness(shopId, candidate.provider);
    if (!readiness.ready) throw new SkipStep(`AI dispatch provider is not ready (${candidate.provider})`);

    const original = defaultProviders(active)[0] || null;
    try {
        await deliveryService.setAiDefaultProvider(shopId, candidate.provider, true);
        const result = await require('../src/modules/order/order.service').bookForOrder(order, {
            shopId,
            requireAiDefault: true,
            throwOnError: true,
        });
        if (!result || result.failed || result.blocked || result.provider !== candidate.provider) {
            throw new Error('AI booking did not use the selected default provider');
        }

        const dispatches = await CourierDispatch.findAll({ where: { shop_id: shopId, order_id: order.id } });
        const providers = dispatches.map((dispatch) => dispatch.provider);
        if (dispatches.length !== 1 || providers[0] !== candidate.provider) {
            throw new Error('AI booking created a dispatch for an unexpected provider');
        }
        if (String(dispatches[0].status).toUpperCase() !== 'COMMITTED') {
            throw new Error('AI booking did not commit its dispatch record');
        }
        return `provider=${candidate.provider}; dispatches=${dispatches.length}; non_default_calls=0`;
    } finally {
        const fresh = await readActiveSandboxIntegrations(shopId);
        const current = defaultProviders(fresh)[0];
        if (original && fresh.some((integration) => integration.provider === original)) {
            await deliveryService.setAiDefaultProvider(shopId, original, true);
        } else if (current) {
            await deliveryService.setAiDefaultProvider(shopId, current, false);
        }
    }
};

const main = async () => {
    const id = runId();
    const summary = [];
    let failed = false;
    let attempted = false;
    const record = (label, status, detail) => {
        report(label, status, detail);
        summary.push({ label, status, detail: detail || null });
        if (status === FAIL) failed = true;
    };
    const runCheck = async (label, operation) => {
        try {
            const detail = await operation();
            attempted = true;
            record(label, PASS, detail);
        } catch (error) {
            if (!(error instanceof SkipStep)) attempted = true;
            record(label, error instanceof SkipStep ? SKIP : FAIL, error instanceof SkipStep ? error.message : safeErrorDetail(error));
        }
    };

    rule();
    line('COURIER LIVE E2E - PATHAO AND REDX SANDBOX');
    line(`Run ID: ${id}`);
    rule();

    const missingInfrastructure = requireInputs(['DATABASE_URL', 'REDIS_URL', 'DELIVERY_ENCRYPTION_KEY']);
    if (missingInfrastructure.length) {
        record('Preflight infrastructure', SKIP, `missing ${missingInfrastructure.join(', ')}`);
    } else if (value('COURIER_LIVE_CONFIRM') !== 'YES') {
        record('Preflight safety acknowledgement', SKIP, 'set COURIER_LIVE_CONFIRM=YES to authorize sandbox mutations');
    } else {
        try {
            const { sequelize } = loadRuntime();
            await sequelize.authenticate();
            record('Postgres connection', PASS, 'authenticated');

            const { getRedisClient } = require('../src/utils/redis-client');
            const redis = getRedisClient();
            if (!redis || typeof redis.ping !== 'function') throw new Error('Redis client unavailable');
            await redis.ping();
            record('Redis connection', PASS, 'ping returned');

            const shopId = value('COURIER_LIVE_SHOP_ID');
            if (!shopId) {
                record('Selected sandbox shop', SKIP, 'COURIER_LIVE_SHOP_ID is not set');
            } else {
                const shop = await loadRuntime().Shop.findByPk(shopId, { attributes: ['id'] });
                if (!shop) record('Selected sandbox shop', FAIL, 'shop ID was not found');
                else record('Selected sandbox shop', PASS, 'shop resolved');
                if (shop) {
                    await runCheck('Activation gate', () => runActivationGate(shopId));
                    await runCheck('AI default switch', () => runAiDefaultSwitch(shopId));
                    await runCheck('AI dispatch isolation', () => runAiDispatchIsolation(shopId));
                }
            }

            await runCheck('Pathao sandbox chain', runPathaoSandbox);
            await runCheck('RedX sandbox chain', runRedxSandbox);
        } catch (error) {
            record('Live runner infrastructure', FAIL, safeErrorDetail(error));
        }
    }

    rule();
    line(`RESULT_JSON ${JSON.stringify({ runId: id, summary })}`);
    if (failed) {
        line('FINAL: FAIL');
        return 1;
    }
    if (!attempted) {
        line('FINAL: SKIP');
        return 2;
    }
    line('FINAL: PASS');
    return 0;
};

if (require.main === module) {
    main()
        .then(async (code) => {
            await closeRuntime();
            process.exit(code);
        })
        .catch(async (error) => {
            line(`FINAL: FAIL - ${safeErrorDetail(error)}`);
            await closeRuntime();
            process.exit(1);
        });
}

module.exports = {
    asList,
    itemId,
    selectOne,
    safeErrorDetail,
};
