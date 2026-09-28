'use strict';

/**
 * PILOT-META-E2E — Customer 360 identity and Sales Opportunities through the
 * REAL signed Meta webhook route, receipt/dedup layer, queue and worker.
 *
 * Proves, at the Meta boundary:
 *   1. a Messenger participant becomes exactly ONE merchant-scoped customer,
 *      even when Meta redelivers the same event;
 *   2. the same PSID on another merchant's Page is a different customer;
 *   3. a purchase-intent conversation that stops becomes one explainable
 *      opportunity — and the detector itself sends nothing to Meta;
 *   4. a later order converts it;
 *   5. a manual follow-up to a customer who opted out is denied by the
 *      central policy engine and never reaches the Graph Send API.
 */

const harness = require('./harness');
const transport = require('./transport');
const fixtures = require('./fixtures');
const { sequelize } = require('../../src/utils/database/database-setup');

const { IDS, CUSTOMER_PSID } = fixtures;

jest.setTimeout(120000);

beforeAll(async () => {
    await harness.setupSuite();
});

beforeEach(async () => {
    await harness.resetRun();
});

afterAll(async () => {
    await harness.teardownSuite();
});

const models = () => require('../../src/modules/entities');

/** Make the stored conversation look like it went quiet `minutes` ago. */
async function quietFor(shopId, minutes) {
    const at = new Date(Date.now() - minutes * 60 * 1000);
    await sequelize.query(`
        UPDATE messages SET created_at = :at
         WHERE conversation_id IN (SELECT id FROM conversations WHERE shop_id = :shopId)`, {
        replacements: { at, shopId },
    });
    await sequelize.query('UPDATE conversations SET updated_at = :at WHERE shop_id = :shopId', {
        replacements: { at, shopId },
    });
    await sequelize.query('UPDATE order_sessions SET last_activity_at = :at WHERE shop_id = :shopId', {
        replacements: { at, shopId },
    });
}

describe('PILOT-META-E2E — customer identity and sales opportunities', () => {
    test('one customer under webhook replay, shop-isolated, detected as an opportunity without any send, converted by an order', async () => {
        const { ShopPilotFeatures, Customer, Message, CustomerOpportunity } = models();
        await ShopPilotFeatures.create({ shop_id: IDS.shopA, customer_intelligence: true, order_confidence_mode: 'off' });

        transport.setCandidate('EM E2E Black Panjabi — ৳1847.');
        const payload = harness.messagePayload({
            pageId: IDS.pageA, psid: CUSTOMER_PSID, text: 'I want to order the black panjabi', mid: 'm_pilot_ci_001',
        });
        expect((await harness.postWebhook(payload)).status).toBe(200);
        // Meta redelivers the identical event.
        expect((await harness.postWebhook(payload)).status).toBe(200);
        await harness.drainQueue();

        const customersA = await Customer.findAll({ where: { shop_id: IDS.shopA, channel_user_id: CUSTOMER_PSID } });
        expect(customersA).toHaveLength(1);
        const [customer] = customersA;
        const inbound = await Message.count({
            where: { sender: 'customer', external_id: 'm_pilot_ci_001' },
        });
        expect(inbound).toBe(1);

        // The same PSID on another merchant's Page is a different, isolated customer.
        await harness.deliver({ pageId: IDS.pageB, psid: CUSTOMER_PSID, text: 'hello', candidate: 'Hello!' });
        const customersB = await Customer.findAll({ where: { shop_id: IDS.shopB, channel_user_id: CUSTOMER_PSID } });
        expect(customersB).toHaveLength(1);
        expect(customersB[0].id).not.toBe(customer.id);

        // The customer goes quiet; the sweep runs.
        await quietFor(IDS.shopA, 60);
        const opportunityService = require('../../src/modules/customer-intelligence/opportunity.service');
        const sendsBefore = transport.capturedSends().length;
        const result = await opportunityService.detectForShop(IDS.shopA);
        expect(result.created).toBe(1);
        expect(transport.capturedSends()).toHaveLength(sendsBefore);

        const opportunity = await CustomerOpportunity.findOne({ where: { shop_id: IDS.shopA, customer_id: customer.id } });
        expect(opportunity).toMatchObject({ status: 'OPEN', strength: 'HIGH' });
        expect(opportunity.reasons).toContain('PURCHASE_INTENT');
        expect(await CustomerOpportunity.count({ where: { shop_id: IDS.shopB } })).toBe(0);

        // A later order for this customer converts it (post-commit hook).
        const { Order } = models();
        const order = await Order.create({
            shop_id: IDS.shopA, customer_id: customer.id, order_number: 'PILOT-E2E-1', total: 1847,
            customer_name: 'E2E Customer', customer_phone: '01711111111', order_status: 'confirmed',
        });
        expect(await opportunityService.convertForOrder(order)).toBe(1);
        await opportunity.reload();
        expect(opportunity).toMatchObject({ status: 'CONVERTED', converted_order_id: order.id });
        expect(transport.capturedSends()).toHaveLength(sendsBefore);
    });

    test('a follow-up to a customer who opted out is denied by the central policy engine and never sent', async () => {
        const { ShopPilotFeatures, Customer, PolicyDecision } = models();
        await ShopPilotFeatures.create({ shop_id: IDS.shopA, customer_intelligence: true, order_confidence_mode: 'off' });

        await harness.deliver({ text: 'I want to order the black panjabi', candidate: 'EM E2E Black Panjabi — ৳1847.' });
        await harness.deliver({ text: 'stop' });
        const customer = await Customer.findOne({ where: { shop_id: IDS.shopA, channel_user_id: CUSTOMER_PSID } });
        expect(customer.messaging_consent.facebook.opted_out_at).toBeTruthy();

        // The detector respects the opt-out: no follow-up task is created.
        await quietFor(IDS.shopA, 60);
        const opportunityService = require('../../src/modules/customer-intelligence/opportunity.service');
        await opportunityService.detectForShop(IDS.shopA);
        const { CustomerOpportunity } = models();
        expect(await CustomerOpportunity.count({ where: { shop_id: IDS.shopA, customer_id: customer.id } })).toBe(0);

        // And if a merchant tries to follow up by hand, the same policy engine
        // as every other outbound message denies it before Meta.
        const followUp = await harness.sendAgentReply({ shopId: IDS.shopA, content: 'Still interested in the panjabi?' });
        expect(followUp.sends).toHaveLength(0);
        const denial = await PolicyDecision.findOne({
            where: { shop_id: IDS.shopA, customer_id: customer.id, allow: false },
            order: [['created_at', 'DESC']],
        });
        expect(denial).toBeTruthy();
    });
});
