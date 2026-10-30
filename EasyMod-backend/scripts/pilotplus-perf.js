'use strict';

/**
 * Pilot+ V1 performance measurement (docs/pilot-plus-v1/08).
 *
 * Real Postgres+Redis (disposable docker pair), representative BD merchant
 * fixtures. Measures per-call medians (no invented ROI): inbox list with/without
 * the P+01 projection on identical data, P+03 queue aggregation, P+02 proposal
 * create/resolve + the per-turn message read it adds, P+04 classify+belt cost,
 * P+05 sweep cost, and EXPLAIN ANALYZE for the three hot new queries.
 *
 * Usage: DATABASE_URL=... REDIS_URL=... node scripts/pilotplus-perf.js
 * Offline: no LLM/provider calls (stage2 rules + services only).
 */

process.env.NODE_ENV = 'test';

const { sequelize } = require('../src/utils/database/database-setup');
const entities = require('../src/modules/entities');
const { v4: uuidv4 } = require('uuid');

const N = 20;

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

async function median(fn, n = N) {
    const samples = [];
    for (let i = 0; i < n; i++) {
        const t0 = process.hrtime.bigint();
        await fn(i);
        samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: +samples[Math.floor(n / 2)].toFixed(2), p95Ms: +samples[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2), samples: n };
}

async function explain(label, sqlFn, ids) {
    const sql = sqlFn(ids);
    const rows = await sequelize.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, { type: require('sequelize').QueryTypes.SELECT })
        .catch(async (e) => [{ 'QUERY PLAN': `explain failed: ${e.message}` }]);
    return { label, plan: rows.map((r) => r['QUERY PLAN'] || JSON.stringify(r)).slice(0, 14) };
}

(async () => {
    const E = entities;
    const results = {};

    // ── Fixtures ─────────────────────────────────────────────────────────────
    const tenants = [];
    const shops = [];
    for (const [name, flags] of [
        ['PerfShopA', { customer_intelligence: true, interaction_choices: true, action_queue: true, knowledge_suggestions: true }],
        ['PerfShopB', { customer_intelligence: false }],
    ]) {
        const tenant = await E.Tenant.create({ name: `${name} ${uuidv4()}` });
        tenants.push(tenant);
        const shop = await E.Shop.create({
            unique_code: `${name.slice(0, 8)}${Date.now() % 99999}`,
            tenant_id: tenant.id,
            shop_name: name,
            name,
        });
        shops.push(shop);
        await E.ShopPilotFeatures.create({
            shop_id: shop.id,
            customer_intelligence: !!flags.customer_intelligence,
            order_confidence_mode: 'off',
            order_confidence_config: {},
            interaction_choices: !!flags.interaction_choices,
            action_queue: !!flags.action_queue,
            knowledge_suggestions: !!flags.knowledge_suggestions,
        });
    }
    const [shopA, shopB] = shops;

    for (const shop of shops) {
        const customers = await E.Customer.bulkCreate(Array.from({ length: 200 }, (_, i) => ({
            id: uuidv4(), shop_id: shop.id, name: `Customer ${i}`, channel_type: 'messenger',
            channel_user_id: `psid-${shop.id.slice(0, 8)}-${i}`, messaging_consent: {},
        })), { returning: true });
        const convs = await E.Conversation.bulkCreate(customers.map((c, i) => ({
            id: uuidv4(), shop_id: shop.id, customer_id: c.id, channel: 'messenger', status: 'active',
            hitl: i % 25 === 0, assignee_id: null, role: 'user', message: 'perf fixture',
            metadata: i % 25 === 0 ? { handoff_reason: 'customer_choice_support' } : {},
            created_at: new Date(now - i * 60_000),
        })), { returning: true });
        await E.Message.bulkCreate(convs.flatMap((c, ci) => Array.from({ length: 10 }, (_, mi) => ({
            id: uuidv4(), conversation_id: c.id, sender: mi % 2 === 0 ? 'customer' : 'ai',
            content: `message ${mi}`, external_id: `m_perf_${ci}_${mi}_${shop.id.slice(0, 8)}`,
            delivery_state: (ci % 25 === 1 && mi === 9) ? 'FAILED' : (mi % 2 === 1 ? 'SENT' : null),
            metadata: (ci % 25 === 1 && mi === 9) ? { executed_mutation_without_outbound_send: true } : {},
            created_at: new Date(now - ci * 60_000 - mi * 1000),
        }))));
        if (shop === shopA) {
            await E.CustomerOpportunity.bulkCreate(customers.slice(0, 10).map((c, i) => ({
                id: uuidv4(), shop_id: shop.id, customer_id: c.id, conversation_id: convs[i].id,
                status: 'OPEN', strength: i < 5 ? 'HIGH' : 'MEDIUM', reasons: ['PURCHASE_INTENT'], signals: [], product_refs: [],
                first_signal_at: iso(3600_000), last_signal_at: iso(1800_000), detected_at: iso(1700_000),
                detector_version: 'opportunity-detector/1.0.0',
            })));
            const OrderSession = require('../src/modules/order/order-session.entity');
            await OrderSession.bulkCreate(Array.from({ length: 10 }, (_, i) => ({
                id: uuidv4(), shop_id: shop.id, customer_id: customers[i].id, customer_channel_id: `psid-${shop.id}-${i}`,
                conversation_id: convs[i].id, channel: 'messenger',
                status: i < 5 ? 'SUSPENDED' : 'ACTIVE', current_step: 'COLLECTING_ADDRESS',
                step_data: i < 5 ? { awaiting_resume: null, suspended_reason: 'HUMAN_HANDOFF_REQUEST' } : { awaiting_resume: 'COLLECTING_ADDRESS' },
                expires_at: new Date(now + 6 * 3600_000), last_activity_at: new Date(now - 30 * 60_000),
            })));
            await E.KnowledgeGap.bulkCreate(Array.from({ length: 1000 }, (_, i) => ({
                shop_id: shop.id, question: i < 600 ? 'exchange korte parbo?' : `variant question ${i % 40}`,
                platform: 'messenger', language: 'bn', source: 'ai_unknown_response',
                created_at: new Date(now - i * 60_000),
            })));
            await E.InboxDeliveryOutbox.bulkCreate(Array.from({ length: 4 }, (_, i) => ({
                id: uuidv4(), shop_id: shop.id, conversation_id: convs[i].id, message_id: uuidv4(),
                status: 'NEEDS_RECONCILIATION', attempts: 1, next_attempt_at: new Date(now + 60_000),
            }))).catch((e) => { results.outboxSeedSkipped = e.message; });
        }
    }
    results.fixtures = { shops: 2, customersPerShop: 200, conversationsPerShop: 200, messagesPerShop: 2000, gaps: 1000 };

    // ── P+01 inbox list: flag ON (projection) vs flag OFF (baseline) ─────────
    const conversationService = require('../src/modules/conversation/conversation.service');
    results.p01_inboxList_flagOn = await median(() => conversationService.getConversations(shopA.id));
    results.p01_inboxList_flagOff = await median(() => conversationService.getConversations(shopB.id));

    // ── P+03 action queue aggregation ────────────────────────────────────────
    const { getInboxActions } = require('../src/modules/inbox/inbox-actions.service');
    results.p03_actionQueue = await median(() => getInboxActions(shopA.id));
    const q = await getInboxActions(shopA.id);
    results.p03_items = q.items.length;

    // ── P+02 interactions: create / render / resolve + per-turn read cost ────
    const interactions = require('../src/modules/interactions/interactions.service');
    const custA = await E.Customer.findOne({ where: { shop_id: shopA.id } });
    const convA = await E.Conversation.findOne({ where: { shop_id: shopA.id, customer_id: custA.id } });
    let lastProposal = null;
    results.p02_createProposal = await median(async () => {
        lastProposal = await interactions.createProposal({
            shopId: shopA.id, customerId: custA.id, customerChannelId: custA.channel_user_id,
            conversationId: convA.id, kind: 'CLARIFY_NEEDS', language: 'bn',
        });
    });
    results.p02_renderQuickReplies = await median(async () => { await interactions.renderQuickReplies(lastProposal.interactionId); });
    const payloadFor = async () => {
        const p = await interactions.createProposal({
            shopId: shopA.id, customerId: custA.id, customerChannelId: custA.channel_user_id,
            conversationId: convA.id, kind: 'CLARIFY_NEEDS', language: 'bn',
        });
        await interactions.markSent(p.interactionId);
        return p.options.find((o) => o.option_id === 'delivery.info').payload;
    };
    const resolveSamples = [];
    for (let i = 0; i < 10; i++) {
        const payload = await payloadFor();
        const t0 = process.hrtime.bigint();
        await interactions.resolveInteraction({
            payload, shopId: shopA.id, customerChannelId: custA.channel_user_id, metaChannelId: null,
            conversationId: convA.id, mutationsAllowed: false,
        });
        resolveSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    resolveSamples.sort((a, b) => a - b);
    results.p02_resolveInteraction = { medianMs: +resolveSamples[5].toFixed(2), p95Ms: +resolveSamples[9].toFixed(2), samples: 10 };

    // Per-inbound added cost: one indexed PK read of the message metadata.
    const convA2 = await E.Conversation.findOne({ where: { shop_id: shopA.id }, attributes: ['id'] });
    const anyMsg = await E.Message.findOne({ where: { conversation_id: convA2.id } });
    results.p02_perTurnMessageRead = await median(async () => {
        await E.Message.findByPk(anyMsg.id, { attributes: ['metadata'] });
    }, 100);

    // ── P+04 deterministic classification cost (CPU-only) ────────────────────
    const { classify, isQuestionShaped } = require('../src/modules/ai/intent/stage2-rules');
    const phrases = ['delivery charge koto?', 'amar name Rahim', 'order 123456 kothay?', 'manush chai', 'ha', 'Mirpur 10 road 5', '01712345678'];
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) classify(phrases[i % phrases.length], { language: i % 2 ? 'bn' : 'en' });
    results.p04_classify5000 = { totalMs: +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1), perCallUs: +(Number(process.hrtime.bigint() - t0) / 1e3 / 5000).toFixed(1) };
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) isQuestionShaped(phrases[i % phrases.length]);
    results.p04_questionShape5000 = { totalMs: +(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(1) };

    // ── P+05 sweep cost on 1000 gaps ─────────────────────────────────────────
    const gapSvc = require('../src/modules/knowledge/gap-suggestions.service');
    results.p05_firstSweep = await (async () => { const t = process.hrtime.bigint(); const r = await gapSvc.computeForShop(shopA.id); return { ...r, ms: +(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1) }; })();
    results.p05_idempotentSweep = await median(() => gapSvc.computeForShop(shopA.id), 3);

    // ── EXPLAIN plans for hot new queries ────────────────────────────────────
    results.explains = [
        await explain('P+01 live opportunity projection (200 customers)', ({ shop }) => `
            SELECT o.id FROM customer_opportunities o
            JOIN customers c ON c.id = o.customer_id AND c.shop_id = o.shop_id
            WHERE o.shop_id = '${shop}' AND o.status IN ('OPEN','ACTIONED')
              AND o.customer_id IN (SELECT id FROM customers WHERE shop_id = '${shop}' LIMIT 200)`,
            { shop: shopA.id }),
        await explain('P+03 conversation scan (capped)', ({ shop }) => `
            SELECT id FROM conversations WHERE shop_id = '${shop}' ORDER BY updated_at DESC LIMIT 200`,
            { shop: shopA.id }),
        await explain('P+02 interaction PK lookup', ({ iid }) => `
            SELECT id, status FROM customer_interactions WHERE id = '${iid}'`,
            { iid: lastProposal.interactionId }),
        await explain('P+05 suggestion live index', ({ shop }) => `
            SELECT id FROM knowledge_gap_suggestions WHERE shop_id = '${shop}' AND status = 'OPEN'`,
            { shop: shopA.id }),
    ];

    // ── Cleanup: remove fixtures (keep DB reusable) ──────────────────────────
    for (const shop of shops) {
        await E.Message.destroy({ where: { conversation_id: { [require('sequelize').Op.in]: (await E.Conversation.findAll({ where: { shop_id: shop.id }, attributes: ['id'] })).map((c) => c.id) } } }).catch(() => {});
        await E.InboxDeliveryOutbox.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.CustomerOpportunity.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.KnowledgeGap.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.Conversation.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.Customer.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        const OrderSession = require('../src/modules/order/order-session.entity');
        await OrderSession.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.ShopPilotFeatures.destroy({ where: { shop_id: shop.id } }).catch(() => {});
        await E.Shop.destroy({ where: { id: shop.id } }).catch(() => {});
    }
    for (const t of tenants) await t.destroy().catch(() => {});

    console.log('\n=== PILOT+ PERF RESULTS ===');
    console.log(JSON.stringify(results, null, 2));
    await sequelize.close();
    process.exit(0);
})().catch((e) => { console.error('PERF_RUN_FAILED', e); process.exit(1); });
