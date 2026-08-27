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
const fs = require('fs');

const DeliveryIntegration = require('../delivery-integration.entity');
const { deliveryValidators } = require('../delivery.validator');
const { PROVIDER_NAMES } = require('../providers/provider.registry');

const MIGRATION_NAME = '20260611_002_delivery_integrations_credentials_text';
const migration = require(path.join(
    __dirname, '../../../database/migrations', `${MIGRATION_NAME}.js`
));
const SANDBOX_MIGRATION_NAME = '20260827_001_delivery_integrations_sandbox';
const sandboxMigration = require(path.join(
    __dirname, '../../../database/migrations', `${SANDBOX_MIGRATION_NAME}.js`
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

    test('sandbox mode is a non-null boolean defaulting to production', () => {
        expect(DeliveryIntegration.rawAttributes.is_sandbox.type.constructor.key).toBe('BOOLEAN');
        expect(DeliveryIntegration.rawAttributes.is_sandbox.allowNull).toBe(false);
        expect(DeliveryIntegration.rawAttributes.is_sandbox.defaultValue).toBe(false);
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

describe(`migration ${SANDBOX_MIGRATION_NAME}`, () => {
    test('exports the custom-runner contract and PostgreSQL up/down statements', async () => {
        const queries = [];
        const fakeSequelize = {
            getDialect: () => 'postgres',
            query: async (sql) => queries.push(sql),
        };

        expect(sandboxMigration.name).toBe(SANDBOX_MIGRATION_NAME);
        await sandboxMigration.up(fakeSequelize);
        await sandboxMigration.down(fakeSequelize);

        const sql = queries.join('\n');
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE/i);
        expect(sql).toMatch(/DROP COLUMN IF EXISTS is_sandbox/i);
    });

    test('SQLite path is idempotent, defaults false, and reverses the column', async () => {
        let columns = [{ name: 'id' }];
        const queries = [];
        const fakeSequelize = {
            getDialect: () => 'sqlite',
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('PRAGMA table_info')) return [columns];
                if (/ADD COLUMN is_sandbox/i.test(sql)) columns.push({ name: 'is_sandbox' });
                if (/DROP COLUMN is_sandbox/i.test(sql)) columns = columns.filter((column) => column.name !== 'is_sandbox');
                return [];
            },
        };

        await sandboxMigration.up(fakeSequelize);
        await sandboxMigration.up(fakeSequelize);
        expect(columns.filter((column) => column.name === 'is_sandbox')).toHaveLength(1);
        expect(queries.filter((sql) => /ADD COLUMN is_sandbox/i.test(sql))).toHaveLength(1);

        await sandboxMigration.down(fakeSequelize);
        await sandboxMigration.down(fakeSequelize);
        expect(columns.some((column) => column.name === 'is_sandbox')).toBe(false);
        expect(queries.filter((sql) => /DROP COLUMN is_sandbox/i.test(sql))).toHaveLength(1);
    });
});

describe('delivery response and provider sandbox contracts', () => {
    test('controller test responses allowlist provider validation data', async () => {
        const mockIntegration = {
            findOne: jest.fn().mockResolvedValue({
                provider: 'pathao',
                is_connected: true,
                is_sandbox: true,
                credentials: { client_id: 'client', client_secret: 'secret' },
                save: jest.fn().mockResolvedValue(true),
            }),
        };
        const mockValidate = jest.fn().mockResolvedValue({
            valid: true,
            access_token: 'access-secret',
            refresh_token: 'refresh-secret',
            stores: [{ store_id: 'store-1', store_name: 'Main store', api_key: 'store-secret' }],
        });
        const mockProvider = jest.fn().mockImplementation(() => ({ validateCredentials: mockValidate }));
        const mockShop = { findByPk: jest.fn() };
        await jest.isolateModulesAsync(async () => {
            jest.doMock('../delivery-integration.entity', () => mockIntegration);
            jest.doMock('../providers/pathao.provider', () => mockProvider);
            jest.doMock('../providers/provider.registry', () => ({
                COURIER_REGISTRY: { pathao: { label: 'Pathao', Provider: mockProvider } },
            }));
            jest.doMock('../../entities', () => ({ Shop: mockShop }));
            const controller = require('../delivery.controller');
            const res = { status: jest.fn(), json: jest.fn() };
            res.status.mockReturnValue(res);

            await controller.testConnection(
                { user: { shopId: 'shop-1' }, body: { provider: 'pathao' } },
                res,
                jest.fn(),
            );

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                data: {
                    valid: true,
                    stores: [{ store_id: 'store-1', store_name: 'Main store' }],
                },
            }));
            expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('access-secret');
            expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('refresh-secret');
        });
    });

    test('delivery service passes persisted sandbox mode to provider constructors', async () => {
        const mockIntegration = {
            findOne: jest.fn().mockResolvedValue({
                credentials: { client_id: 'client' },
                is_active: true,
                is_connected: true,
                is_sandbox: true,
            }),
        };
        const mockProvider = jest.fn();
        await jest.isolateModulesAsync(async () => {
            jest.doMock('../delivery-integration.entity', () => mockIntegration);
            jest.doMock('../providers/provider.registry', () => ({
                COURIER_REGISTRY: { pathao: { Provider: mockProvider } },
            }));
            const service = require('../delivery.service');
            await service.getProviderInstance('shop-1', 'pathao');
            expect(mockProvider).toHaveBeenCalledWith({ client_id: 'client' }, true);
        });
    });

    test('controller source keeps provider credentials out of response paths', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../delivery.controller.js'), 'utf8');
        expect(source).toContain('serializeProviderValidation');
        expect(source).toContain('serializeProviderMetadata');
        expect(source).toContain('integration.is_sandbox === true');
    });
});
