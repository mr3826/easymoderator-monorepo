'use strict';

/**
 * Pilot+ V1 real-stack integration (REAL PostgreSQL + Redis; no mocks of the
 * engines). Covers the five capabilities end-to-end at the service/API layer:
 *   P+01 inbox lead projection consistency      P+02 interaction kernel
 *   P+03 action queue + ownership               P+04 suspend/resume truth
 *   P+05 gap suggestion lifecycle + hygiene
 */

jest.mock('../../notification/merchant-notification.service', () => ({
    notifyShop: jest.fn().mockResolvedValue({ queued: true }),
}));

const request = require('supertest');
const { createFixtures } = require('../../../../tests/helpers/pilot-intelligence.fixtures');
const {
    ShopPilotFeatures, KnowledgeGap, CustomerOpportunity, Message,
} = require('../../entities');
const OrderSession = require('../../order/order-session.entity');
const { Conversation: ConversationModel } = require('../../conversation/conversation.entity');
const interactions = require('../interactions.service');
const opportunityService = require('../../customer-intelligence/opportunity.service');
const conversationService = require('../../conversation/conversation.service');
const gapService = require('../../knowledge/gap-suggestions.service');
const { recordKnowledgeGap } = require('../../knowledge/knowledge-gap-capture.service');
const { FaqResponse } = require('../../entities');

const app = require('../../../app');

const fx = createFixtures('Pilot+ V1 Integration');
const auth = (user, shopId) => ({ Authorization: `Bearer ${fx.tokenFor(user, shopId)}` });

async function enableFlag(shopId, column, value = true) {
    await ShopPilotFeatures.update({ [column]: value }, { where: { shop_id: shopId } });
}

afterAll(async () => { await fx.cleanup(); });

const SESSION_BASE = () => ({
    channel: 'messenger',
    customer_channel_id: 'psid-it-1',
    current_step: 'ORDER_SUMMARY',
    step_data: {
        language: 'en',
        cart: [{ name: 'Lawn Two Piece', price: 1650, quantity: 1 }],
        total: 1710,
        customer_name: 'Rina Akter',
        customer_phone: '01712345678',
        delivery_address: 'Mirpur 10, Dhaka',
        delivery_zone: 'inside_dhaka',
        delivery_charge: 60,
        payment_method: 'cod',
        enabled_gateways: ['cod'],
        confirmed_summary_hash: 'hash-v1',
    },
    status: 'ACTIVE',
    expires_at: new Date(Date.now() + 6 * 3600 * 1000),
});

describe('P+01 inbox lead intelligence — same truth everywhere', () => {
    test('detected opportunity appears once in the inbox projection and stays consistent through merchant actions', async () => {
        const shop = await fx.makeShop({ customerIntelligence: true });
        const owner = await fx.makeMember(shop, 'owner');
        const customer = await fx.makeCustomer(shop, { name: 'Serious Buyer' });
        const conversation = await fx.makeConversation(shop, customer);
        await fx.addCustomerMessage(conversation, 'I want to order this panjabi', 90);
        await fx.addCustomerMessage(conversation, 'delivery charge koto?', 80);

        await opportunityService.detectForShop(shop.id);

        const list = await conversationService.getConversations(shop.id);
        const row = list.conversations.find((c) => c.id === conversation.id);
        expect(row.open_opportunity).toMatchObject({ strength: 'HIGH', status: 'OPEN' });
        expect(row.open_opportunity.reasons).toEqual(expect.arrayContaining(['PURCHASE_INTENT']));

        const [live] = await CustomerOpportunity.findAll({
            where: { shop_id: shop.id, customer_id: customer.id, status: ['OPEN', 'ACTIONED'] },
        });

        const res = await request(app)
            .post(`/api/customer-intelligence/opportunities/${live.id}/contacted`)
            .set(auth(owner, shop.id))
            .send({});
        expect(res.status).toBe(200);

        const list2 = await conversationService.getConversations(shop.id);
        const row2 = list2.conversations.find((c) => c.id === conversation.id);
        expect(row2.open_opportunity.status).toBe('ACTIONED');
        expect(row2.open_opportunity.id).toBe(live.id);

        // single live row only (no duplication from any inbox path)
        expect(await CustomerOpportunity.count({ where: { shop_id: shop.id } })).toBe(1);
    });
});

describe('P+02 interaction kernel — real database semantics', () => {
    test('tap resolves exactly once under concurrent double delivery', async () => {
        const shop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);
        const proposal = await interactions.createProposal({
            shopId: shop.id,
            customerId: customer.id,
            customerChannelId: 'psid-it-1',
            conversationId: conversation.id,
            kind: 'CLARIFY_NEEDS',
            language: 'en',
        });
        await interactions.markSent(proposal.interactionId);
        const payload = proposal.options.find((o) => o.option_id === 'delivery.info').payload;

        const scope = {
            payload, shopId: shop.id, customerChannelId: 'psid-it-1',
            metaChannelId: null, conversationId: conversation.id,
            mutationsAllowed: false,
        };
        const [a, b] = await Promise.all([
            interactions.resolveInteraction(scope),
            interactions.resolveInteraction(scope),
        ]);
        const resolved = [a, b].filter((r) => r.resolved);
        expect(resolved).toHaveLength(1);
        expect(resolved[0].response).toMatch(/৳|\d+/); // real zone pricing from shop settings defaults
        expect([a, b].find((r) => !r.resolved).code).toBe('INTERACTION_ALREADY_HANDLED');
    });

    test('foreign page/customer/conversation/shop are each rejected with no execution', async () => {
        const shop = await fx.makeShop();
        const otherShop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);
        const proposal = await interactions.createProposal({
            shopId: shop.id, customerId: customer.id, customerChannelId: 'psid-a',
            conversationId: conversation.id, kind: 'CLARIFY_NEEDS', language: 'en',
        });
        await interactions.markSent(proposal.interactionId);
        const payload = proposal.options[0].payload;

        const wrong = await interactions.resolveInteraction({
            payload, shopId: otherShop.id, customerChannelId: 'psid-a',
            metaChannelId: null, conversationId: conversation.id, mutationsAllowed: false,
        });
        expect(wrong).toMatchObject({ resolved: false, code: 'INTERACTION_SCOPE_SHOP' });

        const wrongCustomer = await interactions.resolveInteraction({
            payload, shopId: shop.id, customerChannelId: 'psid-B',
            metaChannelId: null, conversationId: conversation.id, mutationsAllowed: false,
        });
        expect(wrongCustomer).toMatchObject({ resolved: false, code: 'INTERACTION_SCOPE_CUSTOMER' });

        const [row] = await require('../interaction.entity').findAll({ where: { id: proposal.interactionId } });
        expect(row.status).toBe('SENT');
    });

    test('confirm choice binds real session state: right hash executes the machine, repriced hash refuses', async () => {
        const shop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);
        const session = await OrderSession.create({
            ...SESSION_BASE(), shop_id: shop.id, customer_id: customer.id, conversation_id: conversation.id,
        });

        const proposal = await interactions.createProposal({
            shopId: shop.id, customerId: customer.id, customerChannelId: 'psid-it-1',
            conversationId: conversation.id, kind: 'CHECKOUT_DECISION', language: 'en',
            session, contextVersion: interactions.contextVersionFor(session),
        });
        await interactions.markSent(proposal.interactionId);
        const confirmPayload = proposal.options.find((o) => o.option_id === 'checkout.confirm').payload;
        expect(confirmPayload).toBeTruthy();

        // Draft-mode equivalence: mutationsAllowed false -> the real machine
        // refuses the mutation (AWAITING_CONFIRMATION), never creates an order.
        const blocked = await interactions.resolveInteraction({
            payload: confirmPayload, shopId: shop.id, customerChannelId: 'psid-it-1',
            metaChannelId: null, conversationId: conversation.id, mutationsAllowed: false,
        });
        expect(blocked.resolved).toBe(true);
        expect(blocked.meta.mutation_blocked).toBe(true);

        // Repricing moves the context version -> a NEW proposal with the OLD
        // version cannot create an order (stale summary).
        await session.update({ step_data: { ...session.step_data, confirmed_summary_hash: 'hash-v2-PRICED-UP' } });
        const stale = await interactions.resolveInteraction({
            payload: confirmPayload, shopId: shop.id, customerChannelId: 'psid-it-1',
            metaChannelId: null, conversationId: conversation.id, mutationsAllowed: true,
        });
        expect(stale).toMatchObject({ resolved: false, code: 'INTERACTION_STALE_CONTEXT' });
    });

    test('supersession keeps at most one live proposal per conversation+kind', async () => {
        const shop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);
        const p1 = await interactions.createProposal({
            shopId: shop.id, customerId: customer.id, customerChannelId: 'psid-it-1',
            conversationId: conversation.id, kind: 'CLARIFY_NEEDS', language: 'en',
        });
        const p2 = await interactions.createProposal({
            shopId: shop.id, customerId: customer.id, customerChannelId: 'psid-it-1',
            conversationId: conversation.id, kind: 'CLARIFY_NEEDS', language: 'en',
        });
        const Model = require('../interaction.entity');
        const first = await Model.findByPk(p1.interactionId);
        const second = await Model.findByPk(p2.interactionId);
        expect(first.status).toBe('SUPERSEDED');
        expect(['GENERATED', 'SENT']).toContain(second.status);
    });
});

describe('P+03 action queue + handoff ownership (API level)', () => {
    test('flag off -> 409; flag on -> ranked authoritative items; resolution removes them', async () => {
        const shop = await fx.makeShop({ customerIntelligence: false });
        const owner = await fx.makeMember(shop, 'owner');
        const customer = await fx.makeCustomer(shop, { name: 'Blocked Buyer' });
        const conversation = await fx.makeConversation(shop, customer);

        // feature off
        const off = await request(app).get('/api/inbox/actions').set(auth(owner, shop.id));
        expect(off.status).toBe(409);
        expect(off.body.error.code).toBe('FEATURE_DISABLED');

        await enableFlag(shop.id, 'action_queue');
        await conversation.update({ hitl: true, assignee_id: owner.id, metadata: { handoff_reason: 'customer_choice_support' } });
        const session = await OrderSession.create({
            ...SESSION_BASE(),
            shop_id: shop.id, customer_id: customer.id, conversation_id: conversation.id,
            current_step: 'COLLECTING_ADDRESS', status: 'SUSPENDED',
            step_data: { ...SESSION_BASE().step_data, suspended_reason: 'HUMAN_HANDOFF_REQUEST' },
        });

        const on = await request(app).get('/api/inbox/actions').set(auth(owner, shop.id));
        expect(on.status).toBe(200);
        const buckets = on.body.data.items.map((i) => i.bucket);
        expect(buckets).toEqual([...buckets].sort((a, b) => a - b)); // operational-risk order
        expect(buckets).toContain(1); // NEEDS_HUMAN
        expect(buckets).toContain(3); // CUSTOMER_BLOCKED (suspended session)
        const human = on.body.data.items.find((i) => i.bucket === 1);
        expect(human.source).toEqual({ type: 'conversation', id: conversation.id });

        // resolution at the source removes the item
        await conversation.update({ hitl: false });
        await session.update({ status: 'ACTIVE', step_data: session.step_data });
        const after = await request(app).get('/api/inbox/actions').set(auth(owner, shop.id));
        expect(after.body.data.items.find((i) => i.bucket === 1)).toBeUndefined();

        // no cross-shop leakage
        const otherShop = await fx.makeShop();
        const otherOwner = await fx.makeMember(otherShop, 'owner');
        await enableFlag(otherShop.id, 'action_queue');
        const foreign = await request(app).get('/api/inbox/actions').set(auth(otherOwner, otherShop.id));
        expect(foreign.body.data.items.every((i) => !String(i.conversation_id || '').includes(conversation.id))).toBe(true);
        expect(foreign.body.data.items.map((i) => i.source.id)).not.toContain(conversation.id);
    });

    test('second staff cannot silently overwrite an assigned open handoff', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const staffA = await fx.makeMember(shop, 'staff');
        const staffB = await fx.makeMember(shop, 'staff');
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);

        await request(app).patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffA, shop.id)).send({ hitl: true }).expect(200);
        const reloaded = await ConversationModel.findByPk(conversation.id);
        expect(String(reloaded.assignee_id)).toBe(String(staffA.id));

        const takeover = await request(app).patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffB, shop.id)).send({ hitl: true });
        expect(takeover.status).toBe(409);
        expect(takeover.body.error.code).toBe('HUMAN_TAKEOVER_CONFLICT');

        const resolveByOther = await request(app).patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffB, shop.id)).send({ hitl: false });
        expect(resolveByOther.status).toBe(409);
        expect(resolveByOther.body.error.code).toBe('HANDOFF_RESOLUTION_CONFLICT');

        await request(app).patch(`/api/conversation/${conversation.id}`)
            .set(auth(staffA, shop.id)).send({ hitl: false }).expect(200);
    });
});

describe('P+04 suspend/resume preserves real collected state', () => {
    test('suspension keeps cart and fields; resume returns the exact step', async () => {
        const shop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const conversation = await fx.makeConversation(shop, customer);
        const session = await OrderSession.create({
            ...SESSION_BASE(),
            shop_id: shop.id, customer_id: customer.id, conversation_id: conversation.id,
            current_step: 'COLLECTING_ADDRESS',
            step_data: { ...SESSION_BASE().step_data, confirmed_summary_hash: null },
        });

        const OrderSessionService = require('../../order/order-session-standalone.service');
        const susp = await OrderSessionService.suspendSession(session.id, shop.id, { reason: 'HUMAN_HANDOFF_REQUEST' });
        expect(susp.suspended).toBe(true);
        const after = await OrderSession.findByPk(session.id);
        expect(after.status).toBe('SUSPENDED');
        expect(after.step_data.customer_name).toBe('Rina Akter');
        expect(after.step_data.cart).toHaveLength(1);

        const resumed = await OrderSessionService.resumeSession(session.id, shop.id);
        expect(resumed.resumed).toBe(true);
        expect(resumed.current_step).toBe('COLLECTING_ADDRESS');
        expect(resumed.prompt).toMatch(/ঠিকানা|address/i);
        const final = await OrderSession.findByPk(session.id);
        expect(final.status).toBe('ACTIVE');
        expect(final.step_data.suspended_reason).toBeUndefined();
    });
});

describe('P+05 gap suggestion lifecycle on real rows', () => {
    test('recurring gaps -> one suggestion; dismiss suppresses; NEW evidence re-opens; publish uses FAQ authority', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        await enableFlag(shop.id, 'knowledge_suggestions');

        for (let i = 0; i < 3; i++) {
            await KnowledgeGap.create({
                shop_id: shop.id, question: 'Exchange korte parbo?',
                platform: 'messenger', language: 'bn', source: 'ai_unknown_response',
            });
        }
        const run1 = await gapService.computeForShop(shop.id);
        expect(run1.created).toBe(1);

        const listed = await gapService.listForShop(shop.id);
        expect(listed[0]).toMatchObject({ owner_domain: 'POLICY', authoritative_action: 'author_faq', evidence_count: 3 });

        // dismiss through the API
        const dismissRes = await request(app)
            .post(`/api/knowledge/gap-suggestions/${listed[0].id}/dismiss`)
            .set(auth(owner, shop.id)).send({ reason: 'ALREADY_ANSWERED' });
        expect(dismissRes.status).toBe(200);

        // recompute with only OLD evidence: must not re-appear
        const run2 = await gapService.computeForShop(shop.id);
        expect(run2.reopened).toBe(0);

        // genuinely NEW unanswered questions past the cursor
        for (let i = 0; i < 3; i++) {
            await KnowledgeGap.create({
                shop_id: shop.id, question: 'exchange korte parbo !!',
                platform: 'messenger', language: 'bn', source: 'low_confidence_handoff',
            });
        }
        const run3 = await gapService.computeForShop(shop.id);
        expect(run3.reopened).toBe(1);

        // publish merchant-authored answer through the API -> real FAQ row active
        const list3 = await gapService.listForShop(shop.id);
        const pub = await request(app)
            .post(`/api/knowledge/gap-suggestions/${list3[0].id}/publish`)
            .set(auth(owner, shop.id))
            .send({ question: 'Exchange?', answer: '7-day exchange on unused items with box.' });
        expect(pub.status).toBe(201);
        const faq = await FaqResponse.findByPk(pub.body.data.faq_id);
        expect(faq).toMatchObject({ shop_id: shop.id, is_active: true });

        const finalList = await gapService.listForShop(shop.id, { statuses: ['PUBLISHED'] });
        expect(finalList[0].resolved_faq_id).toBe(faq.id);
    });

    test('capture hygiene: phone/TrxID never persisted in gap rows', async () => {
        const shop = await fx.makeShop();
        await recordKnowledgeGap({
            shopId: shop.id,
            question: 'delivery to Uttara? my number 01799887766 and trxid AB9987XY',
            platform: 'messenger',
        });
        const row = await KnowledgeGap.findOne({ where: { shop_id: shop.id }, order: [['id', 'DESC']] });
        expect(row.question).not.toContain('01799887766');
        expect(row.question).not.toContain('AB9987XY');
        expect(row.question).toContain('[masked]');
    });
});
