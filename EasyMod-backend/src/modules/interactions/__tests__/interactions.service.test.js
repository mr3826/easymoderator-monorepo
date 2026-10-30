'use strict';

/**
 * P+02 interaction kernel — security-critical unit coverage (channel-neutral).
 * Mirrors acceptance contract AC2-AC8 in docs/pilot-plus-v1/03 §11.
 */

process.env.NODE_ENV = 'test';

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => cb({ transactionId: 'tx' })),
        define: jest.fn(() => ({})),
    },
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));
jest.mock('../interaction.entity', () => ({
    findByPk: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
}));
jest.mock('../../order/order-session-standalone.service', () => ({
    getSessionForInteraction: jest.fn(),
    processStep: jest.fn(),
    cancelSession: jest.fn(),
    resumeSession: jest.fn(),
    getShopDeliveryZones: jest.fn(),
    buildDeliveryZonePrompt: jest.fn(() => 'zones'),
    generateOrderSummary: jest.fn(() => 'SUMMARY ৳1650'),
}));
jest.mock('../../conversation/human-handoff.service', () => ({
    escalateToHuman: jest.fn(),
}));
jest.mock('../../pilot-features/pilot-features.service', () => ({
    isInteractionChoicesEnabled: jest.fn(),
}));

const Model = require('../interaction.entity');
const OrderSessionService = require('../../order/order-session-standalone.service');
const { escalateToHuman } = require('../../conversation/human-handoff.service');
const PilotFeatures = require('../../pilot-features/pilot-features.service');
const interactions = require('../interactions.service');
const contract = require('../interaction.contract');

const SHOP = '11111111-1111-1111-1111-111111111111';
const PSID = 'psid-1';
const CONV = '22222222-2222-2222-2222-222222222222';
const META = '33333333-3333-3333-3333-333333333333';
const IID = '44444444-4444-4444-4444-444444444444';
const SID = '55555555-5555-5555-5555-555555555555';

const liveRow = (over = {}) => ({
    id: IID,
    shop_id: SHOP,
    customer_channel_id: PSID,
    meta_channel_id: META,
    conversation_id: CONV,
    kind: 'CHECKOUT_DECISION',
    bound_entity_type: 'order_session',
    bound_entity_id: SID,
    bound_context_version: 'ORDER_SUMMARY:abc123',
    options: [
        { option_id: 'checkout.review', operation_id: 'checkout.review', title: 'আবার দেখুন' },
        { option_id: 'checkout.confirm', operation_id: 'checkout.confirm', title: 'নিশ্চিত করুন' },
        { option_id: 'checkout.cancel', operation_id: 'checkout.cancel', title: 'বাতিল করুন' },
    ],
    language: 'bn',
    status: 'SENT',
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    ...over,
});

const scope = {
    shopId: SHOP,
    customerChannelId: PSID,
    metaChannelId: META,
    conversationId: CONV,
    mutationsAllowed: true,
};

beforeEach(() => {
    jest.clearAllMocks();
    PilotFeatures.isInteractionChoicesEnabled.mockResolvedValue(true);
    Model.update.mockResolvedValue([1]);
    OrderSessionService.getSessionForInteraction.mockResolvedValue({
        id: SID, shop_id: SHOP, status: 'ACTIVE', current_step: 'ORDER_SUMMARY',
        step_data: { confirmed_summary_hash: 'abc123' },
    });
});

describe('payload format', () => {
    test('round-trips through build/parse and rejects anything forged', () => {
        const payload = contract.buildPayload(IID, 'checkout.confirm');
        expect(contract.parsePayload(payload)).toEqual({ interactionId: IID, optionId: 'checkout.confirm' });
        expect(contract.parsePayload(`p1:${IID}:not.an.operation`)).toBeNull();
        expect(contract.parsePayload('p1:not-a-uuid:checkout.confirm')).toBeNull();
        expect(contract.parsePayload('pay now')).toBeNull();
        expect(contract.parsePayload(null)).toBeNull();
    });

    test('registry enforces Meta transport limits and closed sets', () => {
        const opts = contract.optionsForKind('CHECKOUT_DECISION', 'bn', { boundSession: true });
        expect(opts.length).toBeLessThanOrEqual(contract.MAX_QUICK_REPLIES);
        for (const o of opts) expect(o.title.length).toBeLessThanOrEqual(contract.MAX_TITLE_CHARS);
        expect(contract.validateOptions(opts)).toBe(true);
        // confirm is ONLY offered when bound to a live session
        const unbound = contract.optionsForKind('CHECKOUT_DECISION', 'bn', { boundSession: false });
        expect(unbound.some((o) => o.option_id === 'checkout.confirm')).toBe(false);
    });
});

describe('resolveInteraction — authorization and single execution', () => {
    test('valid choice dispatches exactly once; replay is a no-op', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        OrderSessionService.processStep.mockResolvedValue({ prompt: 'done', completed: true, order: { id: 'ord-1' } });

        const payload = contract.buildPayload(IID, 'checkout.confirm');
        const first = await interactions.resolveInteraction({ payload, ...scope });
        expect(first.resolved).toBe(true);
        expect(first.meta.order.id).toBe('ord-1');

        // second tap: conditional claim update matches zero rows
        Model.update.mockResolvedValue([0]);
        const second = await interactions.resolveInteraction({ payload, ...scope });
        expect(second.resolved).toBe(false);
        expect(second.code).toBe('INTERACTION_ALREADY_HANDLED');
        expect(OrderSessionService.processStep).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['shop', { shopId: '99999999-9999-9999-9999-999999999999' }, 'INTERACTION_SCOPE_SHOP'],
        ['customer', { customerChannelId: 'other-psid' }, 'INTERACTION_SCOPE_CUSTOMER'],
        ['page/channel', { metaChannelId: '99999999-9999-9999-9999-999999999999' }, 'INTERACTION_SCOPE_CHANNEL'],
        ['conversation', { conversationId: '99999999-9999-9999-9999-999999999999' }, 'INTERACTION_SCOPE_CONVERSATION'],
    ])('forged context (%s) is rejected before any dispatch', async (_name, override, code) => {
        Model.findByPk.mockResolvedValue(liveRow());
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'),
            ...scope, ...override,
        });
        expect(res).toEqual(expect.objectContaining({ resolved: false, code }));
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('unknown option not in the row is rejected', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'delivery.info'), ...scope,
        });
        expect(res.code).toBe('INTERACTION_OPTION_UNKNOWN');
    });

    test('expired choice fails safely without side effects', async () => {
        Model.findByPk.mockResolvedValue(liveRow({ expires_at: new Date(Date.now() - 1000) }));
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });
        expect(res.code).toBe('INTERACTION_EXPIRED');
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('a GENERATED choice cannot be resolved before its message is delivered', async () => {
        Model.findByPk.mockResolvedValue(liveRow({ status: 'GENERATED' }));
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });
        expect(res).toEqual(expect.objectContaining({ resolved: false, code: 'INTERACTION_NOT_SENT' }));
        expect(Model.update).not.toHaveBeenCalled();
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('a previously consumed choice is classified as a replay no-op', async () => {
        Model.findByPk.mockResolvedValue(liveRow({ status: 'CONSUMED' }));
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });
        expect(res).toEqual(expect.objectContaining({ resolved: false, code: 'INTERACTION_ALREADY_HANDLED' }));
        expect(Model.update).not.toHaveBeenCalled();
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('a per-shop kill switch turned off before dispatch blocks an in-flight choice', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        PilotFeatures.isInteractionChoicesEnabled
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        // The worker's preflight sees ON; the authoritative resolver sees the
        // revocation after the proposal has been claimed.
        expect(await PilotFeatures.isInteractionChoicesEnabled(SHOP)).toBe(true);

        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });

        expect(res).toEqual(expect.objectContaining({ resolved: false, code: 'INTERACTION_CHOICES_DISABLED' }));
        expect(Model.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'SENT' }),
            expect.objectContaining({ where: expect.objectContaining({ id: IID, status: 'EXECUTING' }) }),
        );
        expect(PilotFeatures.isInteractionChoicesEnabled).toHaveBeenCalledTimes(2);
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('old confirm cannot fire after repricing (bound context version moved)', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        OrderSessionService.getSessionForInteraction.mockResolvedValue({
            id: SID, shop_id: SHOP, status: 'ACTIVE', current_step: 'ORDER_SUMMARY',
            step_data: { confirmed_summary_hash: 'DIFFERENT-PRICE-HASH' },
        });
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });
        expect(res.code).toBe('INTERACTION_STALE_CONTEXT');
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
    });

    test('completed session context rejects the tap', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        OrderSessionService.getSessionForInteraction.mockResolvedValue({
            id: SID, shop_id: SHOP, status: 'COMPLETED', current_step: 'ORDER_SUMMARY', step_data: {},
        });
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope,
        });
        expect(res.code).toBe('INTERACTION_STALE_CONTEXT');
    });

    test('confirm tap re-enters the SAME gated machine path with the caller mutationsAllowed', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        OrderSessionService.processStep.mockResolvedValue({ prompt: 'needs approval', mutation_blocked: true });

        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope, mutationsAllowed: false,
        });

        expect(OrderSessionService.processStep).toHaveBeenCalledWith(
            SID, SHOP, 'confirm', null,
            { mutationsAllowed: false, conversationId: CONV, traceId: null },
        );
        expect(res.meta.mutation_blocked).toBe(true);
    });

    test('handler failure rolls the row back so retry/free-text still work', async () => {
        Model.findByPk.mockResolvedValue(liveRow({ kind: 'CHECKOUT_DECISION' }));
        OrderSessionService.generateOrderSummary.mockImplementation(() => { throw new Error('boom'); });
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.review'), ...scope,
        });
        expect(res.code).toBe('INTERACTION_EXECUTION_FAILED');
        // one of the update calls restored SENT after the failure
        expect(Model.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'SENT' }),
            expect.objectContaining({ where: expect.objectContaining({ status: 'EXECUTING' }) }),
        );
    });

    test('confirm on a SUSPENDED (paused) session is rejected as stale, never executed', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        OrderSessionService.getSessionForInteraction.mockResolvedValue({
            id: SID, shop_id: SHOP, status: 'SUSPENDED', current_step: 'ORDER_SUMMARY',
            step_data: { confirmed_summary_hash: 'abc123' },
        });
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.confirm'), ...scope, mutationsAllowed: true,
        });
        expect(res).toMatchObject({ resolved: false, code: 'INTERACTION_STALE_CONTEXT' });
        expect(OrderSessionService.processStep).not.toHaveBeenCalled();
        expect(Model.update).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'EXECUTING' }),
            expect.anything(),
        );
    });

    test('support.human handoff uses the authoritative escalateToHuman path', async () => {
        Model.findByPk.mockResolvedValue(liveRow({
            kind: 'CLARIFY_NEEDS', bound_entity_type: null, bound_entity_id: null, bound_context_version: null,
            options: [{ option_id: 'support.human', operation_id: 'support.human', title: 'x' }],
        }));
        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'support.human'), ...scope, conversation: { id: CONV },
        });
        expect(res.resolved).toBe(true);
        expect(escalateToHuman).toHaveBeenCalledWith(expect.objectContaining({
            shopId: SHOP, conversationId: CONV, reason: 'customer_choice_support',
        }));
    });

    test('checkout.resume resumes a suspended session and re-asks', async () => {
        Model.findByPk.mockResolvedValue(liveRow({
            kind: 'CHECKOUT_RESUME',
            bound_context_version: 'COLLECTING_ADDRESS:',
            options: [{ option_id: 'checkout.resume', operation_id: 'checkout.resume', title: 'x' }],
        }));
        OrderSessionService.getSessionForInteraction.mockResolvedValue({
            id: SID, shop_id: SHOP, status: 'SUSPENDED', current_step: 'COLLECTING_ADDRESS', step_data: {},
        });
        OrderSessionService.resumeSession.mockResolvedValue({ resumed: true, current_step: 'COLLECTING_ADDRESS', prompt: 'ঠিকানা দিন' });

        const res = await interactions.resolveInteraction({
            payload: contract.buildPayload(IID, 'checkout.resume'), ...scope,
        });
        expect(res.response).toBe('ঠিকানা দিন');
        expect(OrderSessionService.resumeSession).toHaveBeenCalled();
    });
});

describe('numbered choice resolution', () => {
    test('a bare number cannot select a GENERATED proposal before delivery', async () => {
        Model.findAll.mockImplementation(({ where }) => Promise.resolve(
            where.status === 'SENT' ? [] : [liveRow({ status: 'GENERATED' })],
        ));

        const payload = await interactions.findNumberedLivePayload({
            shopId: SHOP, conversationId: CONV, number: '2',
        });

        expect(payload).toBeNull();
        expect(Model.findAll).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'SENT' }),
        }));
    });

    test('a bare number selects a SENT proposal option', async () => {
        Model.findAll.mockResolvedValue([liveRow()]);

        const payload = await interactions.findNumberedLivePayload({
            shopId: SHOP, conversationId: CONV, number: '2',
        });

        expect(payload).toBe(contract.buildPayload(IID, 'checkout.confirm'));
    });
});

describe('proposal creation', () => {
    test('supersedes the live sibling of the same kind and stores opaque-bound options', async () => {
        Model.create.mockResolvedValue({ id: IID });
        const proposal = await interactions.createProposal({
            shopId: SHOP, customerChannelId: PSID, metaChannelId: META, conversationId: CONV,
            kind: 'CHECKOUT_DECISION', language: 'en',
            session: { id: SID, current_step: 'ORDER_SUMMARY', step_data: { confirmed_summary_hash: 'h1' } },
            contextVersion: interactions.contextVersionFor({ current_step: 'ORDER_SUMMARY', step_data: { confirmed_summary_hash: 'h1' } }),
        });
        expect(proposal.interactionId).toBe(IID);
        expect(proposal.options.every((o) => o.payload.startsWith(`p1:${IID}:`))).toBe(true);
        expect(Model.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'SUPERSEDED' }),
            expect.objectContaining({ where: expect.objectContaining({ kind: 'CHECKOUT_DECISION' }) }),
        );
    });

    test('renderQuickReplies enforces live status and expiry', async () => {
        Model.findByPk.mockResolvedValue(liveRow());
        const rendered = await interactions.renderQuickReplies(IID);
        expect(rendered.quick_replies).toHaveLength(3);
        expect(rendered.textFallback).toMatch(/1\)/);

        Model.findByPk.mockResolvedValue(liveRow({ status: 'CONSUMED' }));
        expect(await interactions.renderQuickReplies(IID)).toBeNull();
        Model.findByPk.mockResolvedValue(liveRow({ expires_at: new Date(Date.now() - 1) }));
        expect(await interactions.renderQuickReplies(IID)).toBeNull();
    });
});
