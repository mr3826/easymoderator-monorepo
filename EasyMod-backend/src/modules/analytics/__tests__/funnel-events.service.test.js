'use strict';

const mockAuditLog = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
};

jest.mock('../../audit/audit-log.entity', () => mockAuditLog);

const { buildIdempotencyKey, recordFunnelEvent, recordInternalFunnelEvent } = require('../funnel-events.service');

describe('funnel-events.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuditLog.findOne.mockResolvedValue(null);
    });

    test('rejects event names outside the canonical funnel contract', async () => {
        await expect(recordFunnelEvent({ event: 'made_up_event' }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    test.each(['assistant_test_passed', 'trial_day_7_active'])
        ('rejects %s until a first-party producer exists', async (event) => {
            await expect(recordFunnelEvent({ event })).rejects.toMatchObject({ statusCode: 400 });
            expect(mockAuditLog.create).not.toHaveBeenCalled();
        });

    test('creates a normal audit row without retry deduplication', async () => {
        const row = { id: 'row-1' };
        mockAuditLog.create.mockResolvedValue(row);

        const result = await recordFunnelEvent({
            event: 'landing_view',
            metadata: { source: 'homepage', email: 'private@example.com' },
            req: {
                body: { path: `/${'x'.repeat(600)}`, sessionId: 'session-1' },
                headers: { 'user-agent': 'test-agent' },
                ip: '127.0.0.1',
            },
        });

        expect(result).toBe(row);
        expect(mockAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            action: 'funnel:landing_view',
            idempotency_key: null,
            metadata: expect.objectContaining({ source: 'homepage', session_id: 'session-1' }),
        }));
        const values = mockAuditLog.create.mock.calls[0][0];
        expect(values.metadata.email).toBeUndefined();
        expect(values.metadata.path).toHaveLength(500);
        expect(mockAuditLog.findOrCreate).not.toHaveBeenCalled();
    });

    test('strips query strings and secret-bearing metadata from funnel audit rows', async () => {
        mockAuditLog.create.mockResolvedValue({ id: 'row-safe' });

        await recordFunnelEvent({
            event: 'landing_view',
            metadata: {
                referer: 'https://growth.easymod.tech/search?q=owner%40example.com',
                Authorization: 'Bearer jwt-token',
            },
            req: {
                body: { path: 'https://growth.easymod.tech/search?q=owner%40example.com' },
                headers: { referer: 'https://growth.easymod.tech/?email=owner%40example.com' },
            },
        });

        const values = mockAuditLog.create.mock.calls[0][0];
        expect(values.metadata.path).toBe('https://growth.easymod.tech/search');
        expect(values.metadata.referer).toBe('https://growth.easymod.tech/search');
        expect(values.metadata.Authorization).toBeUndefined();
    });

    test('rejects privileged lifecycle events without a trusted server producer', async () => {
        await expect(recordFunnelEvent({ event: 'first_ai_reply_sent', userId: 'user-1' }))
            .rejects.toMatchObject({ statusCode: 403, code: 'FUNNEL_EVENT_SERVER_ONLY' });
        expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    test('records trusted internal events with actor and correlation metadata', async () => {
        mockAuditLog.create.mockResolvedValue({ id: 'row-2' });
        await recordInternalFunnelEvent({
            event: 'first_order_captured',
            userId: 'user-1',
            shopId: 'shop-1',
            correlationId: 'request-1',
        });
        expect(mockAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'user-1',
            shop_id: 'shop-1',
            metadata: expect.objectContaining({ actor_user_id: 'user-1', correlation_id: 'request-1' }),
        }));
    });

    test('returns a historical row before attempting a deterministic insert', async () => {
        const existing = { id: 'existing-row' };
        mockAuditLog.findOne.mockResolvedValue(existing);

        await expect(recordFunnelEvent({
            event: 'signup_started',
            onceKey: 'retry-key-0001',
        })).resolves.toBe(existing);

        expect(mockAuditLog.findOrCreate).not.toHaveBeenCalled();
        expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    test('uses the same primary key for concurrent-safe retries', async () => {
        const row = { id: 'deduplicated-row' };
        mockAuditLog.findOrCreate.mockResolvedValue([row, true]);

        const payload = { event: 'signup_completed', onceKey: 'retry-key-0002', trustedProducer: true };
        const [first, second] = await Promise.all([
            recordFunnelEvent(payload),
            recordFunnelEvent(payload),
        ]);

        expect(first).toBe(row);
        expect(second).toBe(row);
        expect(mockAuditLog.findOrCreate).toHaveBeenCalledTimes(2);
        const firstId = mockAuditLog.findOrCreate.mock.calls[0][0].where.id;
        const secondId = mockAuditLog.findOrCreate.mock.calls[1][0].where.id;
        expect(firstId).toBe(secondId);
        expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(mockAuditLog.create).not.toHaveBeenCalled();
    });

    test('binds retry identity to tenant context and the scrubbed payload', async () => {
        mockAuditLog.findOrCreate.mockResolvedValue([{ id: 'row-1' }, true]);

        await recordFunnelEvent({
            event: 'signup_started',
            shopId: 'shop-1',
            userId: 'user-1',
            onceKey: 'retry-key-tenant-bound',
            metadata: { source: 'landing', email: 'not-persisted@example.com' },
            req: { body: { sessionId: 'session-1', path: '/' } },
        });
        await recordFunnelEvent({
            event: 'signup_started',
            shopId: 'shop-2',
            userId: 'user-1',
            onceKey: 'retry-key-tenant-bound',
            metadata: { source: 'landing', email: 'not-persisted@example.com' },
            req: { body: { sessionId: 'session-1', path: '/' } },
        });

        const firstKey = mockAuditLog.findOne.mock.calls[0][0].where.idempotency_key;
        const secondKey = mockAuditLog.findOne.mock.calls[1][0].where.idempotency_key;
        expect(firstKey).toMatch(/^funnel:v2:[0-9a-f]{64}$/);
        expect(secondKey).toMatch(/^funnel:v2:[0-9a-f]{64}$/);
        expect(secondKey).not.toBe(firstKey);
        expect(firstKey).not.toContain('not-persisted@example.com');
    });

    test('keeps first-per-entity milestones stable when producer metadata changes', () => {
        const firstKey = buildIdempotencyKey({
            event: 'first_order_captured',
            shopId: 'shop-1',
            onceKey: 'shop-1',
            oncePerEntity: true,
            metadata: { order_id: 'order-1', channel: 'web' },
        });
        const retryKey = buildIdempotencyKey({
            event: 'first_order_captured',
            shopId: 'shop-1',
            onceKey: 'shop-1',
            oncePerEntity: true,
            metadata: { order_id: 'order-2', channel: 'mobile' },
        });

        expect(retryKey).toBe(firstKey);
    });
});
