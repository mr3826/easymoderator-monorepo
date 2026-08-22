'use strict';

const fs = require('fs');
const path = require('path');

const mockAuditCreate = jest.fn(async values => values);
jest.mock('../../modules/entities', () => ({ AuditLog: { create: mockAuditCreate } }));

const { authorize } = require('../../modules/ai/action-gate');
const { createProposedAction } = require('../../modules/ai/contracts/action.contract');
const { withEvidenceSnapshot } = require('../../modules/ai/contracts/evidence.contract');

const workerSource = fs.readFileSync(path.resolve(__dirname, '../message-worker.js'), 'utf8');

const baseContext = (action, evidence, domainHops = 0) => ({
    traceId: 'worker-trace-1',
    tenant: {
        shopId: action.shopId,
        channelId: 'channel-1',
        platform: 'META_MESSENGER',
        customerId: 'customer-1',
        conversationId: action.conversationId,
    },
    tenantRecordsMatch: true,
    currentDomain: domainHops ? 'ORDER' : action.domain,
    domainHops,
    expectedIdempotencyKey: action.idempotencyKey,
    idempotencyCommitted: false,
    evidenceSnapshot: evidence,
    materialStateRevalidated: true,
    customerConfirmationValid: true,
    merchantModeAllowsMutation: true,
    costBudgetAvailable: true,
});

beforeEach(() => jest.clearAllMocks());

test('worker traversal routes mutation context through the gate audit contract', async () => {
    expect(workerSource).toContain('handleOrderFlow');
    expect(workerSource).toContain('mutationsAllowed');
    expect(workerSource).toContain('traceId: job.id || effExternalId || conversationId');

    const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'order summary' });
    const orderAction = createProposedAction({
        requestedByAgent: 'OrderAgent',
        actionType: 'CREATE_ORDER',
        domain: 'ORDER',
        shopId: 'shop-1',
        conversationId: 'conv-1',
        idempotencyKey: '1'.repeat(64),
        evidenceSnapshotHash: evidence.snapshotHash,
        payload: { orderSessionId: 'session-1' },
    });
    const courierAction = createProposedAction({
        requestedByAgent: 'OrderAgent',
        actionType: 'BOOK_COURIER',
        domain: 'COMMERCE_OPS',
        shopId: 'shop-1',
        conversationId: 'conv-1',
        idempotencyKey: '2'.repeat(64),
        evidenceSnapshotHash: evidence.snapshotHash,
        payload: { orderId: 'order-1', provider: 'active' },
    });

    expect((await authorize(orderAction, baseContext(orderAction, evidence))).authorized).toBe(true);
    expect((await authorize(courierAction, baseContext(courierAction, evidence, 1))).authorized).toBe(true);
    expect(mockAuditCreate).toHaveBeenCalledTimes(2);
    expect(mockAuditCreate.mock.calls.map(([row]) => row)).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'ai.action_gate.authorized', resource_type: 'ai_action', resource_id: orderAction.actionId }),
        expect.objectContaining({ action: 'ai.action_gate.authorized', resource_type: 'ai_action', resource_id: courierAction.actionId }),
    ]));
});
