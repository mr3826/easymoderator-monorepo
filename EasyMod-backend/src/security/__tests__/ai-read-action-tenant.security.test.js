'use strict';

const mockAuditCreate = jest.fn(async values => ({ id: 'audit-read-1', ...values }));

jest.mock('../../modules/entities', () => ({ AuditLog: { create: mockAuditCreate } }));

const { recordReadAction } = require('../../modules/ai/action-gate');
const { withEvidenceSnapshot } = require('../../modules/ai/contracts/evidence.contract');
const { AuditLog } = require('../../modules/entities');

const TENANT = {
    shopId: 'shop-1',
    channelId: 'channel-1',
    platform: 'META_MESSENGER',
    customerId: 'customer-1',
    conversationId: 'conversation-1',
};

const evidence = (shopId = TENANT.shopId) => withEvidenceSnapshot({ shopId, sourceText: 'verified read evidence' });

beforeEach(() => {
    mockAuditCreate.mockClear();
});

describe('read-only Action Gate envelope', () => {
    test('refuses a mutating type and audits the anti-smuggling decision', async () => {
        const result = await recordReadAction({
            actionType: 'CREATE_ORDER', tenant: TENANT, traceId: 'trace-1', evidenceSnapshot: evidence(),
            payload: { orderId: 'order-1' },
        });

        expect(result).toEqual({ recorded: false, reasonCode: 'mutating_action_refused' });
        expect(mockAuditCreate).toHaveBeenCalledTimes(1);
        expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
            action: 'ai.action_gate.denied',
            metadata: expect.objectContaining({ reasonCode: 'mutating_action_refused' }),
        }));
    });

    test('refuses evidence or payload that crosses the tenant boundary', async () => {
        const mismatch = await recordReadAction({
            actionType: 'READ_PRODUCT', tenant: TENANT, traceId: 'trace-1', evidenceSnapshot: evidence('shop-2'),
            payload: {},
        });
        expect(mismatch.reasonCode).toBe('tenant_scope_mismatch');
        expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    });

    test('refuses a stale evidence snapshot', async () => {
        const stale = withEvidenceSnapshot({ shopId: TENANT.shopId, sourceText: 'old evidence' }, {
            retrievedAt: new Date(Date.now() - 120000),
            ttlMs: 1000,
        });
        const result = await recordReadAction({
            actionType: 'READ_FAQ', tenant: TENANT, traceId: 'trace-1', evidenceSnapshot: stale,
        });
        expect(result).toEqual({ recorded: false, reasonCode: 'evidence_snapshot_stale' });
        expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    });

    test('denies an order-status read without customer identity', async () => {
        const result = await recordReadAction({
            actionType: 'READ_ORDER_STATUS',
            tenant: { ...TENANT, customerId: null },
            traceId: 'trace-1',
            evidenceSnapshot: evidence(),
            payload: { orderNumber: '123456' },
        });
        expect(result).toEqual({ recorded: false, reasonCode: 'customer_identity_unbound' });
        expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    });

    test('records one valid read and never returns an authorization object', async () => {
        const result = await recordReadAction({
            actionType: 'READ_ORDER_STATUS', tenant: TENANT, traceId: 'trace-1', evidenceSnapshot: evidence(),
            payload: { orderNumber: '123456' },
        });

        expect(result).toEqual({ recorded: true, reasonCode: null });
        expect(result).not.toHaveProperty('authorization');
        expect(mockAuditCreate).toHaveBeenCalledTimes(1);
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            action: 'ai.action_gate.recorded',
            idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/),
            metadata: expect.objectContaining({
                actionType: 'READ_ORDER_STATUS',
                reasonCode: null,
                evidenceSnapshotHash: expect.any(String),
            }),
        }));
    });
});
