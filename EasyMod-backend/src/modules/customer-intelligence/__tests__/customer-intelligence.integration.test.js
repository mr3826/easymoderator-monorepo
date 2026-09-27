'use strict';

/**
 * Customer 360 Lite + Sales Opportunities against REAL PostgreSQL, through
 * the real Express app, auth and shop membership. Opportunity detection uses
 * the real Stage-2 classifier and the real advisory-lock sweep.
 */

jest.mock('../../notification/merchant-notification.service', () => ({
    notifyShop: jest.fn().mockResolvedValue({ queued: true }),
}));

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createFixtures } = require('../../../../tests/helpers/pilot-intelligence.fixtures');
const opportunityService = require('../opportunity.service');
const orderService = require('../../order/order.service');
const { CustomerOpportunity, ShopPilotFeatures, AuditLog } = require('../../entities');
const { sequelize } = require('../../../utils/database/database-setup');

const app = require('../../../app');

const fx = createFixtures('Customer Intelligence IT');
const auth = (user, shop) => ({ Authorization: `Bearer ${fx.tokenFor(user, shop ? shop.id : null)}` });
const liveFor = (shop, customer) => CustomerOpportunity.findAll({
    where: { shop_id: shop.id, customer_id: customer.id, status: ['OPEN', 'ACTIONED'] },
});

afterAll(async () => {
    await fx.cleanup();
});

async function intentConversation(shop, overrides = {}, messages = [['I want to order this panjabi', 90], ['delivery charge koto?', 80]]) {
    const customer = await fx.makeCustomer(shop, overrides);
    const conversation = await fx.makeConversation(shop, customer);
    for (const [text, minutesAgo] of messages) await fx.addCustomerMessage(conversation, text, minutesAgo);
    return { customer, conversation };
}

describe('opportunity detection', () => {
    test('a high-intent conversation that stopped becomes one explainable OPEN opportunity, idempotently', async () => {
        const shop = await fx.makeShop();
        const { customer, conversation } = await intentConversation(shop);

        const first = await opportunityService.detectForShop(shop.id);
        expect(first.created).toBe(1);
        const [opportunity] = await liveFor(shop, customer);
        expect(opportunity).toMatchObject({
            status: 'OPEN', strength: 'HIGH', conversation_id: conversation.id, detector_version: 'opportunity-detector/1.0.0',
        });
        expect(opportunity.reasons).toEqual(expect.arrayContaining(['PURCHASE_INTENT', 'ASKED_DELIVERY_CHARGE']));
        expect(opportunity.signals.every((s) => s.message_id && s.rule)).toBe(true);
        expect(JSON.stringify(opportunity.signals)).not.toContain('panjabi');

        // Replays, overlapping instances and re-runs never duplicate.
        const reruns = await Promise.all([1, 2, 3].map(() => opportunityService.detectForShop(shop.id)));
        expect(reruns.reduce((n, r) => n + r.created, 0)).toBe(0);
        expect(await CustomerOpportunity.count({ where: { shop_id: shop.id, customer_id: customer.id } })).toBe(1);
    });

    test('new signals from the same customer update the live opportunity instead of adding another', async () => {
        const shop = await fx.makeShop();
        const { customer, conversation } = await intentConversation(shop, {}, [['black panjabi ache?', 200], ['cash on delivery hobe?', 190]]);
        await opportunityService.detectForShop(shop.id);
        const [before] = await liveFor(shop, customer);
        expect(before.strength).toBe('MEDIUM');

        await fx.addCustomerMessage(conversation, 'ami eta nibo', 60);
        const result = await opportunityService.detectForShop(shop.id);
        expect(result).toMatchObject({ created: 0, updated: 1 });
        const [after] = await liveFor(shop, customer);
        expect(after.id).toBe(before.id);
        expect(after.strength).toBe('HIGH');
        expect(after.reasons).toContain('PURCHASE_INTENT');
    });

    test.each([
        ['still chatting (inside the quiet period)', [['I want to order this', 5]]],
        ['a single availability question', [['black panjabi ache?', 90]]],
        ['explicit cancel after intent', [['I want to order this', 90], ['order cancel', 85]]],
        ['negated intent', [['order korbo na', 90], ['thanks', 85]]],
    ])('no opportunity when %s', async (_label, messages) => {
        const shop = await fx.makeShop();
        const { customer } = await intentConversation(shop, {}, messages);
        await opportunityService.detectForShop(shop.id);
        expect(await liveFor(shop, customer)).toHaveLength(0);
    });

    test('an opted-out customer is never turned into a follow-up task', async () => {
        const shop = await fx.makeShop();
        const { customer } = await intentConversation(shop, {
            messaging_consent: { facebook: { opted_in: false, opted_out_at: new Date().toISOString() } },
        });
        await opportunityService.detectForShop(shop.id);
        expect(await liveFor(shop, customer)).toHaveLength(0);
    });

    test('an abandoned checkout session is a strong signal with its products', async () => {
        const shop = await fx.makeShop();
        const { customer, conversation } = await intentConversation(shop, {}, [['hello', 120]]);
        const productId = uuidv4();
        await sequelize.query(`
            INSERT INTO order_sessions (id, shop_id, customer_id, customer_channel_id, channel, current_step, step_data, status, automation_mode, confidence_threshold, last_activity_at, created_at, updated_at)
            VALUES (:id, :shopId, :customerId, :psid, 'messenger', 'COLLECTING_ADDRESS', :stepData, 'ABANDONED', 'DRAFT', 60, :at, NOW(), NOW())`, {
            replacements: {
                id: uuidv4(), shopId: shop.id, customerId: customer.id, psid: customer.channel_user_id,
                stepData: JSON.stringify({ cart: [{ product_id: productId, name: 'Black Panjabi', quantity: 2 }] }),
                at: new Date(Date.now() - 110 * 60000),
            },
        });
        await opportunityService.detectForShop(shop.id);
        const [opportunity] = await liveFor(shop, customer);
        expect(opportunity).toMatchObject({ strength: 'HIGH', conversation_id: conversation.id });
        expect(opportunity.reasons).toContain('CHECKOUT_STARTED');
        expect(opportunity.product_refs).toEqual([{ product_id: productId, name: 'Black Panjabi', quantity: 2 }]);
    });

    test('the database refuses a second live opportunity for the same customer', async () => {
        const shop = await fx.makeShop();
        const customer = await fx.makeCustomer(shop);
        const row = {
            shop_id: shop.id, customer_id: customer.id, status: 'OPEN', strength: 'HIGH',
            first_signal_at: new Date(), last_signal_at: new Date(), detector_version: 'test',
        };
        await CustomerOpportunity.create(row);
        await expect(CustomerOpportunity.create({ ...row, status: 'ACTIONED' }))
            .rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
        // A resolved one does not block a new live one.
        await CustomerOpportunity.update({ status: 'DISMISSED' }, { where: { shop_id: shop.id, customer_id: customer.id } });
        await expect(CustomerOpportunity.create(row)).resolves.toBeTruthy();
    });
});

describe('opportunity lifecycle', () => {
    test('an order for the customer converts the opportunity immediately and exactly once', async () => {
        const shop = await fx.makeShop();
        const { customer } = await intentConversation(shop);
        await opportunityService.detectForShop(shop.id);
        const [opportunity] = await liveFor(shop, customer);

        const order = await fx.makeOrder(shop, { customer_id: customer.id, customer_phone: '01720000001' });
        expect(await opportunityService.convertForOrder(order)).toBe(1);
        expect(await opportunityService.convertForOrder(order)).toBe(0);
        await opportunityService.detectForShop(shop.id);

        await opportunity.reload();
        expect(opportunity).toMatchObject({ status: 'CONVERTED', converted_order_id: order.id, resolution_reason: 'ORDER_CREATED' });
        expect(await CustomerOpportunity.count({ where: { shop_id: shop.id, customer_id: customer.id } })).toBe(1);
    });

    test('an unlinked phone order converts through the sweep (read-time phone association)', async () => {
        const shop = await fx.makeShop();
        const { customer } = await intentConversation(shop, { phone: '+8801720000002' });
        await opportunityService.detectForShop(shop.id);
        await fx.makeOrder(shop, { customer_id: null, customer_phone: '01720000002' });
        const result = await opportunityService.detectForShop(shop.id);
        expect(result.converted).toBe(1);
        expect(await liveFor(shop, customer)).toHaveLength(0);
    });

    test('the real order-creation path converts through its post-commit hook', async () => {
        const shop = await fx.makeShop();
        const { customer } = await intentConversation(shop);
        await opportunityService.detectForShop(shop.id);
        const { Product } = require('../../entities');
        const product = await Product.create({ shop_id: shop.id, name: 'Pilot Panjabi', price: 1500, quantity: 10, track_quantity: false });
        const subscriptionService = require('../../subscription/subscription.service');
        jest.spyOn(subscriptionService, 'checkOrderLimit').mockResolvedValue(true);
        jest.spyOn(subscriptionService, 'trackUsage').mockResolvedValue({ transactionId: null });
        const order = await orderService.createOrderInternal(shop.id, {
            customer_id: customer.id,
            customer_name: 'Pilot Customer',
            customer_phone: '01720000003',
            delivery_address: 'House 12, Road 5, Dhanmondi, Dhaka',
            channel: 'messenger',
            order_status: 'confirmed',
            payment_status: 'paid',
            items: [{ product_id: product.id, quantity: 1 }],
        });
        const opportunity = await CustomerOpportunity.findOne({ where: { shop_id: shop.id, customer_id: customer.id } });
        expect(opportunity).toMatchObject({ status: 'CONVERTED', converted_order_id: order.id });
    });

    test('a dismissed opportunity does not come back without new customer intent', async () => {
        const shop = await fx.makeShop();
        const owner = await fx.makeMember(shop, 'owner');
        const { customer, conversation } = await intentConversation(shop);
        await opportunityService.detectForShop(shop.id);
        const [opportunity] = await liveFor(shop, customer);

        const dismissed = await request(app)
            .post(`/api/customer-intelligence/opportunities/${opportunity.id}/dismiss`)
            .set(auth(owner, shop))
            .send({ reason: 'NOT_INTERESTED' });
        expect(dismissed.status).toBe(200);
        expect(dismissed.body.data.status).toBe('DISMISSED');
        expect(await AuditLog.findOne({ where: { shop_id: shop.id, action: 'OPPORTUNITY_DISMISSED', resource_id: opportunity.id } }))
            .toBeTruthy();

        await opportunityService.detectForShop(shop.id);
        expect(await liveFor(shop, customer)).toHaveLength(0);

        await fx.addCustomerMessage(conversation, 'I want to order two of these', 40);
        await opportunityService.detectForShop(shop.id);
        expect(await liveFor(shop, customer)).toHaveLength(1);
    });

    test('merchant actions are state-checked: contacted once, then a repeat is a 409', async () => {
        const shop = await fx.makeShop();
        const staff = await fx.makeMember(shop, 'staff');
        const { customer } = await intentConversation(shop);
        await opportunityService.detectForShop(shop.id);
        const [opportunity] = await liveFor(shop, customer);
        const url = `/api/customer-intelligence/opportunities/${opportunity.id}/contacted`;

        expect((await request(app).post(url).set(auth(staff, shop)).send({})).status).toBe(200);
        const again = await request(app).post(url).set(auth(staff, shop)).send({});
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('OPPORTUNITY_STATE_CONFLICT');
        expect((await request(app)
            .post(`/api/customer-intelligence/opportunities/${opportunity.id}/dismiss`)
            .set(auth(staff, shop)).send({ reason: 'MADE_UP' })).status).toBe(400);
    });

    test('stale opportunities expire', async () => {
        const shop = await fx.makeShop();
        const { customer, conversation } = await intentConversation(shop);
        await opportunityService.detectForShop(shop.id);
        const [opportunity] = await liveFor(shop, customer);
        // A week later nothing new happened: messages, thread and signal are all old.
        const eightDays = 8 * 24 * 60;
        await sequelize.query(`UPDATE messages SET created_at = NOW() - INTERVAL '8 days' WHERE conversation_id = :id`, {
            replacements: { id: conversation.id },
        });
        await fx.backdate('conversations', conversation.id, eightDays, 'updated_at');
        await fx.backdate('customer_opportunities', opportunity.id, eightDays, 'last_signal_at');
        const result = await opportunityService.detectForShop(shop.id);
        expect(result.expired).toBe(1);
        await opportunity.reload();
        expect(opportunity).toMatchObject({ status: 'EXPIRED', resolution_reason: 'NO_ACTIVITY' });
    });
});

describe('Customer 360 API', () => {
    test('list and detail reflect this shop\'s orders, outcomes, timeline and opportunities', async () => {
        const shop = await fx.makeShop();
        const staff = await fx.makeMember(shop, 'staff');
        const repeat = await fx.makeCustomer(shop, { name: 'Repeat Buyer', phone: '01730000001' });
        await fx.makeOrder(shop, { customer_id: repeat.id, customer_phone: '01730000001', total: 1000, delivery_status: 'delivered', delivered_at: new Date(), delivery_tracking_code: 'T1' });
        await fx.makeOrder(shop, { customer_id: repeat.id, customer_phone: '01730000001', total: 2000, order_status: 'delivered', delivery_status: 'delivered', delivery_tracking_code: 'T2' });
        // An unlinked manual order to the same phone, stored in another spelling.
        await fx.makeOrder(shop, { customer_id: null, customer_phone: '+8801730000001', total: 500, order_status: 'cancelled' });
        const { customer: interested } = await intentConversation(shop, { name: 'Interested Shopper' });
        await opportunityService.detectForShop(shop.id);

        const list = await request(app).get('/api/customer-intelligence/customers').set(auth(staff, shop));
        expect(list.status).toBe(200);
        const byName = Object.fromEntries(list.body.data.map((c) => [c.name, c]));
        expect(byName['Repeat Buyer']).toMatchObject({
            state: 'REPEAT_BUYER', total_orders: 3, delivered_orders: 2, delivered_value: 3000, open_opportunity: null,
        });
        expect(byName['Interested Shopper']).toMatchObject({ state: 'INTERESTED', open_opportunity: { strength: 'HIGH' } });

        const opportunitiesView = await request(app)
            .get('/api/customer-intelligence/customers?view=opportunities').set(auth(staff, shop));
        expect(opportunitiesView.body.data.map((c) => c.id)).toEqual([interested.id]);

        const search = await request(app)
            .get('/api/customer-intelligence/customers?search=%2B8801730000001').set(auth(staff, shop));
        expect(search.body.data.map((c) => c.id)).toEqual([repeat.id]);

        const detail = await request(app).get(`/api/customer-intelligence/customers/${repeat.id}`).set(auth(staff, shop));
        expect(detail.status).toBe(200);
        expect(detail.body.data.summary).toMatchObject({
            total_orders: 3, delivered_orders: 2, cancelled_orders: 1, delivered_value: 3000, ordered_value: 3000,
        });
        expect(detail.body.data.orders.map((o) => o.link).sort()).toEqual(['CUSTOMER', 'CUSTOMER', 'PHONE_MATCH']);
        expect(detail.body.data.timeline.map((e) => e.type)).toEqual(expect.arrayContaining([
            'ORDER_PLACED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'CUSTOMER_FIRST_SEEN',
        ]));
        expect(detail.body.data.rto_signal).toMatchObject({ available: true, tier: 'clear' });
    });

    test('another shop\'s customer and opportunity ids return 404 and change nothing', async () => {
        const shopA = await fx.makeShop();
        const shopB = await fx.makeShop();
        const ownerB = await fx.makeMember(shopB, 'owner');
        const { customer } = await intentConversation(shopA);
        await opportunityService.detectForShop(shopA.id);
        const [opportunity] = await liveFor(shopA, customer);

        expect((await request(app).get(`/api/customer-intelligence/customers/${customer.id}`).set(auth(ownerB, shopB))).status).toBe(404);
        expect((await request(app).post(`/api/customer-intelligence/opportunities/${opportunity.id}/dismiss`)
            .set(auth(ownerB, shopB)).send({ reason: 'OTHER' })).status).toBe(404);
        const list = await request(app).get('/api/customer-intelligence/customers').set(auth(ownerB, shopB));
        expect(list.body.data.map((c) => c.id)).not.toContain(customer.id);
        await opportunity.reload();
        expect(opportunity.status).toBe('OPEN');
    });

    test('a shop without the pilot flag is told so, and the status endpoint always answers', async () => {
        const shop = await fx.makeShop({ customerIntelligence: false, orderConfidenceMode: 'off' });
        const owner = await fx.makeMember(shop, 'owner');
        const status = await request(app).get('/api/customer-intelligence/status').set(auth(owner, shop));
        expect(status.body.data).toEqual({ customer_intelligence: false, order_confidence_mode: 'off' });
        const list = await request(app).get('/api/customer-intelligence/customers').set(auth(owner, shop));
        expect(list.status).toBe(409);
        expect(list.body.code).toBe('FEATURE_DISABLED');
        expect((await request(app).get('/api/customer-intelligence/customers')).status).toBe(401);
    });
});

describe('pilot flags are platform-controlled', () => {
    test('a shop member cannot enable or change pilot flags through shop settings', async () => {
        const shop = await fx.makeShop({ customerIntelligence: false, orderConfidenceMode: 'off' });
        const owner = await fx.makeMember(shop, 'owner');
        await request(app)
            .patch(`/api/shop/${shop.id}`)
            .set(auth(owner, shop))
            .send({ settings: { pilot_features: { customer_intelligence: true, order_confidence_mode: 'off' } } });
        const flags = await ShopPilotFeatures.findByPk(shop.id);
        expect(flags).toMatchObject({ customer_intelligence: false, order_confidence_mode: 'off' });
    });

    test('only a SUPER_ADMIN can change them, and every change is audited', async () => {
        const shop = await fx.makeShop({ customerIntelligence: false, orderConfidenceMode: 'off' });
        const owner = await fx.makeMember(shop, 'owner');
        const superAdmin = await fx.makeMember(null, 'none', { platformRole: 'SUPER_ADMIN' });
        const url = `/api/admin/shops/${shop.id}/pilot-features`;

        expect((await request(app).patch(url).set(auth(owner, shop)).send({ customer_intelligence: true })).status).toBe(403);
        const bad = await request(app).patch(url).set(auth(superAdmin, null)).send({ order_confidence_mode: 'sometimes' });
        expect(bad.status).toBe(400);
        const ok = await request(app).patch(url).set(auth(superAdmin, null))
            .send({ customer_intelligence: true, order_confidence_mode: 'shadow', order_confidence_config: { high_value_cod_threshold: 8000 } });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({
            customer_intelligence: true, order_confidence_mode: 'shadow',
            order_confidence_config: { high_value_cod_threshold: 8000, address_min_length: 15 },
        });
        const audit = await AuditLog.findOne({ where: { shop_id: shop.id, action: 'admin:pilot_features_update' } });
        expect(audit.user_id).toBe(superAdmin.id);
        expect(audit.old_values).toMatchObject({ order_confidence_mode: 'off' });
        expect(audit.new_values).toMatchObject({ order_confidence_mode: 'shadow' });
    });

    // Last in the file on purpose: it switches every shop off.
    test('the global kill switch turns every shop back to pre-pilot behaviour', async () => {
        const shop = await fx.makeShop({ customerIntelligence: true, orderConfidenceMode: 'enforce' });
        const owner = await fx.makeMember(shop, 'owner');
        const superAdmin = await fx.makeMember(null, 'none', { platformRole: 'SUPER_ADMIN' });
        expect((await request(app).post('/api/admin/pilot-features/disable-all').set(auth(owner, shop))).status).toBe(403);
        const result = await request(app).post('/api/admin/pilot-features/disable-all').set(auth(superAdmin, null));
        expect(result.status).toBe(200);
        expect(result.body.data.affected).toBeGreaterThanOrEqual(1);
        expect(await ShopPilotFeatures.findByPk(shop.id)).toMatchObject({ customer_intelligence: false, order_confidence_mode: 'off' });
    });
});
