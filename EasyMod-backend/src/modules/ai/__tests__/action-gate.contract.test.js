'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../../entities', () => ({
    AuditLog: { create: jest.fn(async values => ({ id: 'audit-1', ...values })) },
}));

const {
    ACTION_GATE_CHECK_NAMES,
    authorize,
    recordActionGateOutcome,
    verifyAuthorization,
} = require('../action-gate');
const {
    canonicalJson,
    canonicalOrderSummary,
    confirmedSummaryHash,
    createProposedAction,
    deriveAcceptPaymentIdempotencyKey,
    deriveBookCourierIdempotencyKey,
    deriveCreateOrderIdempotencyKey,
} = require('../contracts/action.contract');
const { withEvidenceSnapshot } = require('../contracts/evidence.contract');
const { AuditLog } = require('../../entities');

const SUMMARY = {
    currency: 'bdt',
    customerName: '  Rahim  Uddin ',
    customerPhone: '01711111111',
    address: 'Mirpur   10, Dhaka',
    deliveryCharge: 60,
    deliveryMethod: 'courier',
    paymentMethod: 'cod',
    items: [{ productId: 'p-1', variantId: 'v-1', quantity: 1, unitPrice: 1200 }],
    total: 1260,
};

const validContext = (evidence, action) => ({
    traceId: 'trace-1',
    tenant: {
        shopId: action.shopId,
        channelId: 'channel-1',
        platform: 'META_MESSENGER',
        customerId: 'customer-1',
        conversationId: action.conversationId,
    },
    tenantRecordsMatch: true,
    currentDomain: 'ORDER',
    domainHops: 0,
    expectedIdempotencyKey: action.idempotencyKey,
    idempotencyCommitted: false,
    evidenceSnapshot: evidence,
    materialStateRevalidated: true,
    customerConfirmationValid: true,
    merchantModeAllowsMutation: true,
    costBudgetAvailable: true,
});

beforeEach(() => jest.clearAllMocks());

describe('A2 contract primitives', () => {
    test('canonical summary is stable across object key order and normalizes phone/money', () => {
        const left = canonicalOrderSummary(SUMMARY);
        const right = canonicalOrderSummary({
            total: 1260,
            items: [{ quantity: 1, unitPrice: 1200, productId: 'p-1', variantId: 'v-1' }],
            paymentMethod: 'COD',
            deliveryMethod: 'COURIER',
            deliveryCharge: 60,
            address: 'Mirpur 10, Dhaka',
            customerPhone: '+8801711111111',
            customerName: 'Rahim Uddin',
            currency: 'BDT',
        });

        expect(canonicalJson(left)).toBe(canonicalJson(right));
        expect(left.customer.phone).toBe('+8801711111111');
        expect(left.items[0].unitPrice).toBe(120000);
    });

    test('summary hash and each action idempotency derivation are deterministic', () => {
        const summaryHash = confirmedSummaryHash(SUMMARY);
        expect(deriveCreateOrderIdempotencyKey({
            shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 'session-1', confirmedSummaryHash: summaryHash,
        })).toHaveLength(64);
        expect(deriveBookCourierIdempotencyKey({ shopId: 'shop-1', orderId: 'order-1', provider: 'steadfast' }))
            .toHaveLength(64);
        expect(deriveAcceptPaymentIdempotencyKey({ shopId: 'shop-1', orderId: 'order-1', trxId: 'trx-1' }))
            .toHaveLength(64);
        expect(confirmedSummaryHash({ ...SUMMARY, total: 1261 })).not.toBe(summaryHash);
    });
});

describe('Action Gate', () => {
    test('runs all 17 checks, audits, and mints a verifiable authorization', async () => {
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'live order summary' });
        const summaryHash = confirmedSummaryHash(SUMMARY);
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent',
            actionType: 'CREATE_ORDER',
            domain: 'ORDER',
            shopId: 'shop-1',
            conversationId: 'conv-1',
            idempotencyKey: deriveCreateOrderIdempotencyKey({
                shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 'session-1', confirmedSummaryHash: summaryHash,
            }),
            evidenceSnapshotHash: evidence.snapshotHash,
            payload: { orderSessionId: 'session-1', summaryHash },
        });

        const result = await authorize(action, validContext(evidence, action));

        expect(result.authorized).toBe(true);
        expect(ACTION_GATE_CHECK_NAMES).toHaveLength(17);
        expect(Object.keys(result.checkResults)).toEqual(expect.arrayContaining(ACTION_GATE_CHECK_NAMES));
        expect(verifyAuthorization(result.authorization, {
            actionType: 'CREATE_ORDER', shopId: 'shop-1', idempotencyKey: action.idempotencyKey,
        })).toBe(true);
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            action: 'ai.action_gate.authorized',
            resource_type: 'ai_action',
            idempotency_key: action.idempotencyKey,
            metadata: expect.objectContaining({ checkResults: expect.objectContaining({
                contract_version_supported: true,
                customer_confirmation_valid: true,
            }) }),
        }));
    });

    test('fails closed when the AI order mutation kill switch is disabled', async () => {
        const previous = process.env.AI_ORDER_MUTATIONS_ENABLED;
        process.env.AI_ORDER_MUTATIONS_ENABLED = 'false';
        try {
            const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'live order summary' });
            const summaryHash = confirmedSummaryHash(SUMMARY);
            const action = createProposedAction({
                requestedByAgent: 'OrderAgent',
                actionType: 'CREATE_ORDER',
                domain: 'ORDER',
                shopId: 'shop-1',
                conversationId: 'conv-1',
                idempotencyKey: deriveCreateOrderIdempotencyKey({
                    shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 'session-1', confirmedSummaryHash: summaryHash,
                }),
                evidenceSnapshotHash: evidence.snapshotHash,
                payload: { orderSessionId: 'session-1', summaryHash },
            });

            const result = await authorize(action, validContext(evidence, action));
            expect(result.authorized).toBe(false);
            expect(result.reasonCode).toBe('runtime_kill_switch_enabled');
            expect(result.checkResults.runtime_kill_switch_enabled).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.AI_ORDER_MUTATIONS_ENABLED;
            else process.env.AI_ORDER_MUTATIONS_ENABLED = previous;
        }
    });

    test('revokes an already-issued order authorization when its kill switch is disabled', async () => {
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'live order summary' });
        const summaryHash = confirmedSummaryHash(SUMMARY);
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent',
            actionType: 'CREATE_ORDER',
            domain: 'ORDER',
            shopId: 'shop-1',
            conversationId: 'conv-1',
            idempotencyKey: deriveCreateOrderIdempotencyKey({
                shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 'session-1', confirmedSummaryHash: summaryHash,
            }),
            evidenceSnapshotHash: evidence.snapshotHash,
            payload: { orderSessionId: 'session-1', summaryHash },
        });
        const result = await authorize(action, validContext(evidence, action));
        expect(result.authorized).toBe(true);

        const previous = process.env.AI_ORDER_MUTATIONS_ENABLED;
        process.env.AI_ORDER_MUTATIONS_ENABLED = 'false';
        try {
            expect(verifyAuthorization(result.authorization, { actionType: 'CREATE_ORDER', shopId: 'shop-1' })).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.AI_ORDER_MUTATIONS_ENABLED;
            else process.env.AI_ORDER_MUTATIONS_ENABLED = previous;
        }
    });

    test('ACCEPT_PAYMENT has its own kill switch and fails closed when off', async () => {
        // IC-V1 review F2: every mutating capability needs an explicit sub-flag.
        // Before the fix, ACCEPT_PAYMENT fell through to "allow".
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'payment confirmed' });
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent',
            actionType: 'ACCEPT_PAYMENT',
            domain: 'COMMERCE_OPS',
            shopId: 'shop-1',
            conversationId: 'conv-1',
            idempotencyKey: deriveAcceptPaymentIdempotencyKey({ shopId: 'shop-1', orderId: 'order-1', trxId: 'trx-1' }),
            evidenceSnapshotHash: evidence.snapshotHash,
            payload: { orderId: 'order-1', trxId: 'trx-1' },
        });
        const previous = process.env.AI_PAYMENT_ACCEPTANCE_ENABLED;
        process.env.AI_PAYMENT_ACCEPTANCE_ENABLED = 'false';
        try {
            const result = await authorize(action, { ...validContext(evidence, action), currentDomain: 'ORDER' });
            expect(result.authorized).toBe(false);
            expect(result.reasonCode).toBe('runtime_kill_switch_enabled');
        } finally {
            if (previous === undefined) delete process.env.AI_PAYMENT_ACCEPTANCE_ENABLED;
            else process.env.AI_PAYMENT_ACCEPTANCE_ENABLED = previous;
        }
    });

    test('appends the sanitized mutation and outbound result linked to the gate decision', async () => {
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'live order summary' });
        const summaryHash = confirmedSummaryHash(SUMMARY);
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent',
            actionType: 'CREATE_ORDER',
            domain: 'ORDER',
            shopId: 'shop-1',
            conversationId: 'conv-1',
            idempotencyKey: deriveCreateOrderIdempotencyKey({
                shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 'session-1', confirmedSummaryHash: summaryHash,
            }),
            evidenceSnapshotHash: evidence.snapshotHash,
            payload: { orderSessionId: 'session-1', summaryHash },
        });
        const authorizationResult = await authorize(action, { ...validContext(evidence, action), taskId: 'task-1' });
        const result = await recordActionGateOutcome({
            authorization: authorizationResult.authorization,
            mutationResult: { success: true, state: 'ORDER_CREATED', resourceId: 'order-1', raw: 'must not be stored' },
            outboundResult: { success: false, state: 'PENDING', code: 'SEND_PENDING', body: 'private customer text' },
        });

        expect(result.recorded).toBe(true);
        expect(AuditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({
            action: 'ai.action_gate.result_recorded',
            idempotency_key: expect.any(String),
            metadata: expect.objectContaining({
                gateDecisionId: authorizationResult.gateDecisionId,
                actionType: 'CREATE_ORDER',
                taskId: 'task-1',
                conversationId: 'conv-1',
                mutationResult: { success: true, state: 'ORDER_CREATED', code: null, resourceId: 'order-1' },
                outboundResult: { success: false, state: 'PENDING', code: 'SEND_PENDING', resourceId: null },
            }),
        }));
        const lastAudit = AuditLog.create.mock.calls.at(-1)[0];
        expect(JSON.stringify(lastAudit)).not.toContain('private customer text');
        expect(JSON.stringify(lastAudit)).not.toContain('must not be stored');
    });

    test('fails closed when tenant or evidence context is incomplete', async () => {
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'summary' });
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent',
            actionType: 'CREATE_ORDER',
            domain: 'ORDER',
            shopId: 'shop-1',
            conversationId: 'conv-1',
            idempotencyKey: 'a'.repeat(64),
            evidenceSnapshotHash: evidence.snapshotHash,
            payload: {},
        });

        const result = await authorize(action, {
            traceId: 'trace-1',
            tenant: { shopId: 'shop-1', conversationId: 'conv-1' },
            tenantRecordsMatch: false,
            domainHops: 0,
            evidenceSnapshot: { ...evidence, snapshotHash: 'tampered' },
        });

        expect(result.authorized).toBe(false);
        expect(result.reasonCode).toBe('tenant_context_complete');
        expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai.action_gate.denied' }));
    });

    test('rejects tampered and expired authorization tokens', async () => {
        const evidence = withEvidenceSnapshot({ shopId: 'shop-1', sourceText: 'summary' });
        const summaryHash = confirmedSummaryHash(SUMMARY);
        const action = createProposedAction({
            requestedByAgent: 'OrderAgent', actionType: 'CREATE_ORDER', domain: 'ORDER', shopId: 'shop-1', conversationId: 'conv-1',
            idempotencyKey: deriveCreateOrderIdempotencyKey({ shopId: 'shop-1', conversationId: 'conv-1', orderSessionId: 's', confirmedSummaryHash: summaryHash }),
            evidenceSnapshotHash: evidence.snapshotHash, payload: {},
        });
        const result = await authorize(action, validContext(evidence, action));

        expect(verifyAuthorization({ ...result.authorization, signature: 'bad' }, { actionType: 'CREATE_ORDER' })).toBe(false);
        expect(verifyAuthorization({ ...result.authorization, expiresAt: new Date(Date.now() - 1).toISOString() })).toBe(false);
    });
});
