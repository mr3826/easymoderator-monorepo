'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require() of the module under test
// ---------------------------------------------------------------------------

const mockAuditLogCreate = jest.fn();
const mockAuditLogFindAll = jest.fn();

jest.mock('../audit-log.entity', () => ({
    create: mockAuditLogCreate,
    findAll: mockAuditLogFindAll
}));

const mockIdempotencyKeyFindOrCreate = jest.fn();
const mockIdempotencyKeyFindOne = jest.fn();
const mockIdempotencyKeyUpdate = jest.fn();
const mockIdempotencyKeyCleanupExpired = jest.fn();

jest.mock('../idempotency-key.entity', () => ({
    findOrCreate: mockIdempotencyKeyFindOrCreate,
    findOne: mockIdempotencyKeyFindOne,
    update: mockIdempotencyKeyUpdate,
    cleanupExpired: mockIdempotencyKeyCleanupExpired
}));

// user.entity is required lazily inside getAuditLogs / getShopAuditLogs via require()
jest.mock('../../user/user.entity', () => ({
    id: 'user-entity-mock'
}));

// sequelize Op is needed inside getShopAuditLogs
jest.mock('sequelize', () => {
    const actual = jest.requireActual('sequelize');
    return { ...actual, Op: actual.Op || { gte: Symbol('gte'), lte: Symbol('lte') } };
});

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const AuditService = require('../audit.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHOP_ID = 'shop-uuid-001';
const USER_ID = 'user-uuid-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditService', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // logOperation
    // -----------------------------------------------------------------------

    describe('logOperation', () => {
        const baseArgs = {
            userId: USER_ID,
            shopId: SHOP_ID,
            action: 'CREATE',
            resourceType: 'PRODUCT',
            resourceId: 'prod-123'
        };

        it('creates an audit log with all required fields', async () => {
            mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-1' });

            await AuditService.logOperation(baseArgs);

            expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
            expect(mockAuditLogCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    user_id: USER_ID,
                    shop_id: SHOP_ID,
                    action: 'CREATE',
                    resource_type: 'PRODUCT',
                    resource_id: 'prod-123'
                })
            );
        });

        it('defaults optional fields to null when not provided', async () => {
            mockAuditLogCreate.mockResolvedValueOnce({});

            await AuditService.logOperation(baseArgs);

            const call = mockAuditLogCreate.mock.calls[0][0];
            expect(call.old_values).toBeNull();
            expect(call.new_values).toBeNull();
            expect(call.metadata).toBeNull();
            expect(call.ip_address).toBeNull();
            expect(call.user_agent).toBeNull();
            expect(call.idempotency_key).toBeNull();
        });

        it('passes all optional fields when provided', async () => {
            mockAuditLogCreate.mockResolvedValueOnce({});

            await AuditService.logOperation({
                ...baseArgs,
                oldValues: { status: 'draft' },
                newValues: { status: 'active' },
                metadata: { source: 'api' },
                ipAddress: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                idempotencyKey: 'idem-key-abc'
            });

            const call = mockAuditLogCreate.mock.calls[0][0];
            expect(call.old_values).toEqual({ status: 'draft' });
            expect(call.new_values).toEqual({ status: 'active' });
            expect(call.metadata).toEqual({ source: 'api' });
            expect(call.ip_address).toBe('127.0.0.1');
            expect(call.user_agent).toBe('Mozilla/5.0');
            expect(call.idempotency_key).toBe('idem-key-abc');
        });

        it('does not throw when AuditLog.create rejects (fire-and-forget)', async () => {
            mockAuditLogCreate.mockRejectedValueOnce(new Error('DB down'));

            await expect(AuditService.logOperation(baseArgs)).resolves.toBeUndefined();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to create audit log:',
                expect.any(Error)
            );
        });

        it('works when userId and shopId are null (system job context)', async () => {
            mockAuditLogCreate.mockResolvedValueOnce({});

            await AuditService.logOperation({
                userId: null,
                shopId: null,
                action: 'job:daily_overage_calculator',
                resourceType: 'job',
                resourceId: '2026-05-09'
            });

            expect(mockAuditLogCreate).toHaveBeenCalledWith(
                expect.objectContaining({ user_id: null, shop_id: null })
            );
        });

        it('returns undefined on success (no meaningful return value)', async () => {
            mockAuditLogCreate.mockResolvedValueOnce({ id: 'log-2' });
            const result = await AuditService.logOperation(baseArgs);
            expect(result).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // checkIdempotency
    // -----------------------------------------------------------------------

    describe('checkIdempotency', () => {
        const key = 'idem-key-xyz';
        const endpoint = '/api/products';
        const method = 'POST';
        const requestData = { name: 'Widget', price: 9.99 };

        it('returns null immediately when idempotencyKey is falsy', async () => {
            const result = await AuditService.checkIdempotency(null, USER_ID, SHOP_ID, endpoint, method, requestData);
            expect(result).toBeNull();
            expect(mockIdempotencyKeyFindOrCreate).not.toHaveBeenCalled();
        });

        it('returns null when the key is newly created (first request)', async () => {
            mockIdempotencyKeyFindOrCreate.mockResolvedValueOnce([
                { idempotency_key: key, shop_id: SHOP_ID, response_data: null, status_code: null },
                true // created = true
            ]);

            const result = await AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData);
            expect(result).toBeNull();
        });

        it('returns { inFlight: true } when another request holds the key with no response yet', async () => {
            const requestHash = AuditService.createRequestHash(requestData);
            mockIdempotencyKeyFindOrCreate.mockResolvedValueOnce([
                {
                    idempotency_key: key,
                    shop_id: SHOP_ID,
                    request_hash: requestHash,
                    response_data: null,
                    status_code: null
                },
                false // already existed
            ]);

            const result = await AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData);
            expect(result).toEqual({ inFlight: true });
        });

        it('returns { statusCode, data } when a completed response is cached', async () => {
            const requestHash = AuditService.createRequestHash(requestData);
            const cachedData = { id: 'prod-999', name: 'Widget' };
            mockIdempotencyKeyFindOrCreate.mockResolvedValueOnce([
                {
                    idempotency_key: key,
                    shop_id: SHOP_ID,
                    request_hash: requestHash,
                    response_data: cachedData,
                    status_code: 201
                },
                false
            ]);

            const result = await AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData);
            expect(result).toEqual({ statusCode: 201, data: cachedData });
        });

        it('throws when key is reused with different request data', async () => {
            const differentHash = AuditService.createRequestHash({ name: 'Different', price: 0 });
            mockIdempotencyKeyFindOrCreate.mockResolvedValueOnce([
                {
                    idempotency_key: key,
                    shop_id: SHOP_ID,
                    request_hash: differentHash,
                    response_data: null,
                    status_code: null
                },
                false
            ]);

            await expect(
                AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData)
            ).rejects.toThrow('Idempotency key used with different request data');
        });

        it('handles SequelizeUniqueConstraintError by falling back to findOne', async () => {
            const requestHash = AuditService.createRequestHash(requestData);
            const uniqueError = new Error('Unique constraint violation');
            uniqueError.name = 'SequelizeUniqueConstraintError';

            mockIdempotencyKeyFindOrCreate.mockRejectedValueOnce(uniqueError);
            mockIdempotencyKeyFindOne.mockResolvedValueOnce({
                idempotency_key: key,
                shop_id: SHOP_ID,
                request_hash: requestHash,
                response_data: { id: 'prod-777' },
                status_code: 200
            });

            const result = await AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData);
            expect(result).toEqual({ statusCode: 200, data: { id: 'prod-777' } });
            expect(mockIdempotencyKeyFindOne).toHaveBeenCalledTimes(1);
        });

        it('rethrows non-uniqueness errors from findOrCreate', async () => {
            const dbError = new Error('Connection timeout');
            dbError.name = 'SequelizeConnectionError';
            mockIdempotencyKeyFindOrCreate.mockRejectedValueOnce(dbError);

            await expect(
                AuditService.checkIdempotency(key, USER_ID, SHOP_ID, endpoint, method, requestData)
            ).rejects.toThrow('Connection timeout');
        });
    });

    // -----------------------------------------------------------------------
    // storeIdempotencyResult
    // -----------------------------------------------------------------------

    describe('storeIdempotencyResult', () => {
        it('calls IdempotencyKey.update with statusCode and responseData', async () => {
            mockIdempotencyKeyUpdate.mockResolvedValueOnce([1]);
            const responseData = { id: 'prod-1', name: 'Widget' };

            await AuditService.storeIdempotencyResult('key-abc', SHOP_ID, 201, responseData);

            expect(mockIdempotencyKeyUpdate).toHaveBeenCalledWith(
                { response_data: responseData, status_code: 201 },
                { where: { idempotency_key: 'key-abc', shop_id: SHOP_ID } }
            );
        });

        it('does nothing and returns early when idempotencyKey is falsy', async () => {
            await AuditService.storeIdempotencyResult(null, SHOP_ID, 200, {});
            expect(mockIdempotencyKeyUpdate).not.toHaveBeenCalled();
        });

        it('does nothing when idempotencyKey is empty string', async () => {
            await AuditService.storeIdempotencyResult('', SHOP_ID, 200, {});
            expect(mockIdempotencyKeyUpdate).not.toHaveBeenCalled();
        });

        it('does not throw when update rejects (swallows DB errors)', async () => {
            mockIdempotencyKeyUpdate.mockRejectedValueOnce(new Error('DB error'));
            await expect(
                AuditService.storeIdempotencyResult('key-abc', SHOP_ID, 200, {})
            ).resolves.toBeUndefined();
            expect(console.error).toHaveBeenCalledWith(
                'Failed to store idempotency result:',
                expect.any(Error)
            );
        });

        it('stores a null responseData without issue', async () => {
            mockIdempotencyKeyUpdate.mockResolvedValueOnce([1]);
            await AuditService.storeIdempotencyResult('key-null', SHOP_ID, 204, null);
            expect(mockIdempotencyKeyUpdate).toHaveBeenCalledWith(
                { response_data: null, status_code: 204 },
                expect.any(Object)
            );
        });

        it('stores complex nested response data', async () => {
            mockIdempotencyKeyUpdate.mockResolvedValueOnce([1]);
            const complex = { items: [{ id: 1 }, { id: 2 }], meta: { total: 2 } };
            await AuditService.storeIdempotencyResult('key-complex', SHOP_ID, 200, complex);
            expect(mockIdempotencyKeyUpdate).toHaveBeenCalledWith(
                { response_data: complex, status_code: 200 },
                expect.any(Object)
            );
        });
    });

    // -----------------------------------------------------------------------
    // createRequestHash
    // -----------------------------------------------------------------------

    describe('createRequestHash', () => {
        it('produces a 64-character hex SHA-256 string', () => {
            const hash = AuditService.createRequestHash({ a: 1 });
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });

        it('is deterministic: same input always yields the same hash', () => {
            const data = { name: 'Widget', price: 9.99 };
            expect(AuditService.createRequestHash(data)).toBe(AuditService.createRequestHash(data));
        });

        it('is key-order independent: {b,a} === {a,b}', () => {
            const h1 = AuditService.createRequestHash({ b: 2, a: 1 });
            const h2 = AuditService.createRequestHash({ a: 1, b: 2 });
            expect(h1).toBe(h2);
        });

        it('produces different hashes for different inputs', () => {
            const h1 = AuditService.createRequestHash({ name: 'A' });
            const h2 = AuditService.createRequestHash({ name: 'B' });
            expect(h1).not.toBe(h2);
        });

        it('handles deeply nested objects with key ordering', () => {
            const h1 = AuditService.createRequestHash({ z: { b: 2, a: 1 }, a: 'top' });
            const h2 = AuditService.createRequestHash({ a: 'top', z: { a: 1, b: 2 } });
            expect(h1).toBe(h2);
        });

        it('handles arrays (preserving element order)', () => {
            const h1 = AuditService.createRequestHash([1, 2, 3]);
            const h2 = AuditService.createRequestHash([1, 2, 3]);
            const h3 = AuditService.createRequestHash([3, 2, 1]);
            expect(h1).toBe(h2);
            expect(h1).not.toBe(h3);
        });

        it('returns a stable hash for null', () => {
            const h1 = AuditService.createRequestHash(null);
            const h2 = AuditService.createRequestHash(null);
            expect(h1).toBe(h2);
            expect(h1).toMatch(/^[a-f0-9]{64}$/);
        });

        it('returns a stable hash for undefined', () => {
            const h1 = AuditService.createRequestHash(undefined);
            const h2 = AuditService.createRequestHash(undefined);
            expect(h1).toBe(h2);
        });

        it('handles primitive string input', () => {
            const h1 = AuditService.createRequestHash('hello');
            const h2 = AuditService.createRequestHash('hello');
            expect(h1).toBe(h2);
            expect(h1).not.toBe(AuditService.createRequestHash('world'));
        });

        it('handles primitive number input', () => {
            const h = AuditService.createRequestHash(42);
            expect(h).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    // -----------------------------------------------------------------------
    // cleanupExpiredIdempotencyKeys
    // -----------------------------------------------------------------------

    describe('cleanupExpiredIdempotencyKeys', () => {
        it('returns the number of deleted keys from cleanupExpired()', async () => {
            mockIdempotencyKeyCleanupExpired.mockResolvedValueOnce(7);
            const count = await AuditService.cleanupExpiredIdempotencyKeys();
            expect(count).toBe(7);
        });

        it('returns 0 when nothing was deleted', async () => {
            mockIdempotencyKeyCleanupExpired.mockResolvedValueOnce(0);
            const count = await AuditService.cleanupExpiredIdempotencyKeys();
            expect(count).toBe(0);
        });

        it('calls cleanupExpired exactly once', async () => {
            mockIdempotencyKeyCleanupExpired.mockResolvedValueOnce(3);
            await AuditService.cleanupExpiredIdempotencyKeys();
            expect(mockIdempotencyKeyCleanupExpired).toHaveBeenCalledTimes(1);
        });

        it('returns 0 and does not throw when cleanupExpired rejects', async () => {
            mockIdempotencyKeyCleanupExpired.mockRejectedValueOnce(new Error('DB timeout'));
            const count = await AuditService.cleanupExpiredIdempotencyKeys();
            expect(count).toBe(0);
            expect(console.error).toHaveBeenCalledWith(
                'Failed to cleanup expired idempotency keys:',
                expect.any(Error)
            );
        });

        it('logs the number of cleaned keys to console', async () => {
            mockIdempotencyKeyCleanupExpired.mockResolvedValueOnce(5);
            await AuditService.cleanupExpiredIdempotencyKeys();
            expect(console.log).toHaveBeenCalledWith('Cleaned up 5 expired idempotency keys');
        });
    });

    // -----------------------------------------------------------------------
    // getAuditLogs
    // -----------------------------------------------------------------------

    describe('getAuditLogs', () => {
        const resourceType = 'PRODUCT';
        const resourceId = 'prod-abc';

        it('calls AuditLog.findAll with correct where clause', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getAuditLogs(resourceType, resourceId);

            expect(mockAuditLogFindAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { resource_type: resourceType, resource_id: resourceId }
                })
            );
        });

        it('uses default limit=50 and offset=0 when no options supplied', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getAuditLogs(resourceType, resourceId);

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.limit).toBe(50);
            expect(args.offset).toBe(0);
        });

        it('respects custom limit and offset options', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getAuditLogs(resourceType, resourceId, { limit: 10, offset: 20 });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.limit).toBe(10);
            expect(args.offset).toBe(20);
        });

        it('returns the array returned by findAll', async () => {
            const logs = [{ id: 'log-1' }, { id: 'log-2' }];
            mockAuditLogFindAll.mockResolvedValueOnce(logs);

            const result = await AuditService.getAuditLogs(resourceType, resourceId);
            expect(result).toBe(logs);
        });

        it('orders results by created_at DESC', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getAuditLogs(resourceType, resourceId);

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.order).toEqual([['created_at', 'DESC']]);
        });

        it('includes user association with id, full_name, email attributes', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getAuditLogs(resourceType, resourceId);

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.include).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        as: 'user',
                        attributes: ['id', 'full_name', 'email']
                    })
                ])
            );
        });

        it('returns empty array when no logs match', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            const result = await AuditService.getAuditLogs(resourceType, resourceId);
            expect(result).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // getShopAuditLogs
    // -----------------------------------------------------------------------

    describe('getShopAuditLogs', () => {
        it('always filters by shopId', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID);

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.shop_id).toBe(SHOP_ID);
        });

        it('uses default limit=100 and offset=0', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID);

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.limit).toBe(100);
            expect(args.offset).toBe(0);
        });

        it('filters by userId when provided', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID, { userId: USER_ID });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.user_id).toBe(USER_ID);
        });

        it('filters by action when provided', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID, { action: 'DELETE' });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.action).toBe('DELETE');
        });

        it('filters by resourceType when provided', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID, { resourceType: 'ORDER' });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.resource_type).toBe('ORDER');
        });

        it('adds created_at gte filter when startDate is provided', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            const startDate = new Date('2026-01-01');
            await AuditService.getShopAuditLogs(SHOP_ID, { startDate });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.created_at).toBeDefined();
            const createdAtFilter = args.where.created_at;
            // One of the symbol keys should be the startDate
            const values = Object.values(createdAtFilter);
            expect(values).toContain(startDate);
        });

        it('adds created_at lte filter when endDate is provided', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            const endDate = new Date('2026-12-31');
            await AuditService.getShopAuditLogs(SHOP_ID, { endDate });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            const values = Object.values(args.where.created_at);
            expect(values).toContain(endDate);
        });

        it('does not add created_at filter when neither startDate nor endDate given', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID, {});

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where.created_at).toBeUndefined();
        });

        it('returns the array from findAll', async () => {
            const logs = [{ id: 'log-shop-1' }];
            mockAuditLogFindAll.mockResolvedValueOnce(logs);
            const result = await AuditService.getShopAuditLogs(SHOP_ID);
            expect(result).toBe(logs);
        });

        it('supports combined filters (userId + action + resourceType)', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            await AuditService.getShopAuditLogs(SHOP_ID, {
                userId: USER_ID,
                action: 'UPDATE',
                resourceType: 'SHOP'
            });

            const args = mockAuditLogFindAll.mock.calls[0][0];
            expect(args.where).toMatchObject({
                shop_id: SHOP_ID,
                user_id: USER_ID,
                action: 'UPDATE',
                resource_type: 'SHOP'
            });
        });

        it('returns empty array when no logs match', async () => {
            mockAuditLogFindAll.mockResolvedValueOnce([]);
            const result = await AuditService.getShopAuditLogs(SHOP_ID);
            expect(result).toEqual([]);
        });
    });
});
