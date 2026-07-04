/**
 * Schema contracts for the delivery integration flow.
 *
 * POST /shop/delivery/connect 500'd in production because the model writes
 * AES-encrypted credentials (an "iv:ciphertext" string) while the prod column
 * was still JSONB from the original squash migration — Postgres rejects a
 * non-JSON string with "invalid input syntax for type json". These tests pin
 * the entity/registry/migration invariants that made that drift possible.
 */

const path = require('path');

const DeliveryIntegration = require('../delivery-integration.entity');
const { deliveryValidators } = require('../delivery.validator');
const { PROVIDER_NAMES } = require('../providers/provider.registry');

const MIGRATION_NAME = '20260611_002_delivery_integrations_credentials_text';
const migration = require(path.join(
    __dirname, '../../../database/migrations', `${MIGRATION_NAME}.js`
));

describe('DeliveryIntegration entity schema contracts', () => {
    test('provider enum accepts every provider the registry (and Joi validator) allows', () => {
        const enumValues = DeliveryIntegration.rawAttributes.provider.values;
        for (const provider of PROVIDER_NAMES) {
            expect(enumValues).toContain(provider);
        }
    });

    test('credentials column is TEXT — encrypted payload is not valid JSON', () => {
        const type = DeliveryIntegration.rawAttributes.credentials.type;
        expect(type.constructor.key).toBe('TEXT');
    });

    test('credentials setter produces an iv:ciphertext string that JSON.parse rejects', () => {
        const instance = DeliveryIntegration.build({
            shop_id: '00000000-0000-0000-0000-000000000000',
            provider: 'steadfast',
            credentials: { api_key: 'k', secret_key: 's' }
        });
        const stored = instance.getDataValue('credentials');
        expect(typeof stored).toBe('string');
        expect(stored).toMatch(/^[a-f0-9]{32}:[a-f0-9]+$/);
        expect(() => JSON.parse(stored)).toThrow();
        // and the getter round-trips it
        expect(instance.credentials).toEqual({ api_key: 'k', secret_key: 's' });
    });
});

describe('delivery toggle request contract', () => {
    test('accepts frontend camelCase isActive and normalizes to is_active', () => {
        const { error, value } = deliveryValidators.toggleProvider.validate(
            { provider: 'pathao', isActive: true },
            { abortEarly: false, stripUnknown: true }
        );

        expect(error).toBeUndefined();
        expect(value).toEqual({ provider: 'pathao', is_active: true });
    });

    test('accepts canonical snake_case is_active', () => {
        const { error, value } = deliveryValidators.toggleProvider.validate(
            { provider: 'steadfast', is_active: false },
            { abortEarly: false, stripUnknown: true }
        );

        expect(error).toBeUndefined();
        expect(value).toEqual({ provider: 'steadfast', is_active: false });
    });

    test('still requires an explicit active state', () => {
        const { error } = deliveryValidators.toggleProvider.validate(
            { provider: 'redx' },
            { abortEarly: false, stripUnknown: true }
        );

        expect(error?.details.map((detail) => detail.message)).toContain('is_active is required');
    });
});

describe(`migration ${MIGRATION_NAME}`, () => {
    test('exports the custom-runner contract { name, up, down }', () => {
        expect(migration.name).toBe(MIGRATION_NAME);
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
    });

    test('up converts credentials to TEXT idempotently (guarded by current type)', async () => {
        const queries = [];
        const fakeSequelize = { query: async (sql) => { queries.push(sql); } };
        await migration.up(fakeSequelize);
        const all = queries.join('\n');
        expect(all).toMatch(/delivery_integrations/);
        expect(all).toMatch(/TYPE TEXT/i);
        expect(all).toMatch(/data_type = 'jsonb'/i);
    });
});
