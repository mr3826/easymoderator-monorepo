'use strict';

/**
 * Interactions service (Pilot+ P+02) — server-side structured customer
 * choices. Channel-neutral kernel; the Messenger adapter (quick replies) and
 * the future storefront adapter both only serialize/dispatch this contract.
 *
 * Security model (docs/pilot-plus-v1/03 §4.2 / 05 T1-T5):
 *   - the payload is an opaque reference; the ROW is the authority;
 *   - resolve re-loads and re-checks: shop, customer channel, meta channel,
 *     conversation, option membership, expiry, live status, bound business
 *     context version — any mismatch rejects with no side effect;
 *   - single execution via SELECT ... FOR UPDATE + conditional transition;
 *   - every operation re-enters the EXISTING typed-equivalent code path
 *     (step machine, gated cancel, handoff) — a tap can never bypass reply
 *     mode, the Action Gate, material revalidation, consent or policy.
 */

const { sequelize } = require('../../utils/database/database-setup');
const { createLogger } = require('../../utils/structured-logger');
const metrics = require('../pilot-features/pilot-metrics');
const contract = require('./interaction.contract');
const { buildPayload, parsePayload, optionsForKind, KINDS, OPERATIONS, TTL_MS } = contract;

const logger = createLogger('Interactions');

const Interaction = () => require('./interaction.entity');

const nowIso = () => new Date().toISOString();
const asString = (v) => (v === null || v === undefined ? null : String(v));

/**
 * Create (or replace) a live proposal of one kind per conversation.
 * `session` (optional) is the loaded OrderSession row the proposal binds to;
 * `contextVersion` pins the business state (step + confirmed summary hash).
 */
async function createProposal({
    shopId,
    customerId = null,
    customerChannelId,
    metaChannelId = null,
    conversationId,
    kind,
    language = 'bn',
    session = null,
    contextVersion = null,
    createdBy = 'worker',
}) {
    if (!shopId || !conversationId || !customerChannelId || !KINDS[kind]) {
        return null;
    }
    if (!contract.KIND_OPERATIONS[kind]) return null;

    const options = optionsForKind(kind, language === 'en' ? 'en' : 'bn', {
        boundSession: Boolean(session),
    });
    if (options.length === 0) return null;

    const Model = Interaction();
    const ttl = TTL_MS[kind] || TTL_MS.CLARIFY_NEEDS;
    const expiresAt = new Date(Date.now() + ttl);

    return sequelize.transaction(async (t) => {
        // Supersede any live sibling of the same kind in this conversation.
        await Model.update(
            { status: 'SUPERSEDED', updated_at: nowIso() },
            {
                where: { conversation_id: conversationId, kind, status: ['GENERATED', 'SENT'] },
                transaction: t,
            },
        );
        const row = await Model.create({
            shop_id: shopId,
            customer_id: customerId,
            customer_channel_id: String(customerChannelId),
            meta_channel_id: metaChannelId || null,
            conversation_id: conversationId,
            kind,
            bound_entity_type: session ? 'order_session' : null,
            bound_entity_id: session ? String(session.id) : null,
            bound_context_version: session ? (contextVersion || String(session.current_step)) : null,
            allowed_operation_ids: contract.KIND_OPERATIONS[kind],
            options,
            language: language === 'en' ? 'en' : 'bn',
            status: 'GENERATED',
            expires_at: expiresAt,
            created_by: createdBy,
        }, { transaction: t });
        metrics.increment('interaction.generated');
        return {
            interactionId: row.id,
            kind,
            expiresAt,
            options: options.map((o) => ({ ...o, payload: buildPayload(row.id, o.option_id) })),
        };
    });
}

/** Mark a proposal delivered with its carrier message (GENERATED -> SENT). */
async function markSent(interactionId) {
    const Model = Interaction();
    const [updated] = await Model.update(
        { status: 'SENT', updated_at: nowIso() },
        { where: { id: interactionId, status: 'GENERATED' } },
    );
    return updated > 0;
}

function contextVersionFor(session) {
    const step = session.current_step || '';
    const hash = (session.step_data && session.step_data.confirmed_summary_hash) || '';
    return `${step}:${hash}`;
}

/**
 * Render the payload that a send may attach (Messenger adapter). The send
 * itself goes through the normal policy chain — this only serializes.
 */
async function renderQuickReplies(interactionId) {
    const Model = Interaction();
    const row = await Model.findByPk(interactionId);
    if (!row || !contract.LIVE_STATUSES.includes(row.status)) return null;
    if (new Date(row.expires_at) <= new Date()) return null;
    const language = row.language === 'en' ? 'en' : 'bn';
    const quick_replies = (row.options || []).map((o) => ({
        title: o.title,
        content_type: 'text',
        payload: buildPayload(row.id, o.option_id),
    }));
    const textFallback = (row.options || [])
        .map((o, i) => `${i + 1}) ${o.title}`)
        .join('\n');
    return { interactionId: row.id, quick_replies, textFallback, language };
}

function reject(code, reason) {
    metrics.increment('interaction.rejected');
    logger.info('interaction_rejected', { code, reason });
    return { resolved: false, code, reason };
}

/**
 * The single authoritative resolver. ctx must carry scope from the VERIFIED
 * session/webhook context (never from the payload).
 */
async function resolveInteraction({
    payload,
    shopId,
    customerChannelId,
    metaChannelId = null,
    conversationId,
    conversation = null,
    mutationsAllowed = false,
    platform = 'facebook',
    recipientId = null,
    turnId = null,
    turnStartedAt = null,
    traceId = null,
}) {
    const parsed = parsePayload(payload);
    if (!parsed) return reject('INTERACTION_PAYLOAD_INVALID', 'payload is not a registered interaction');
    const { interactionId, optionId } = parsed;

    const Model = Interaction();
    const row = await Model.findByPk(interactionId);
    if (!row) return reject('INTERACTION_UNKNOWN', 'unknown interaction');

    // Scope — every dimension must match the verified inbound context.
    if (asString(row.shop_id) !== asString(shopId)) return reject('INTERACTION_SCOPE_SHOP', 'shop mismatch');
    if (asString(row.conversation_id) !== asString(conversationId)) return reject('INTERACTION_SCOPE_CONVERSATION', 'conversation mismatch');
    if (asString(row.customer_channel_id) !== asString(customerChannelId)) return reject('INTERACTION_SCOPE_CUSTOMER', 'customer mismatch');
    if (asString(row.meta_channel_id || null) !== asString(metaChannelId || null)) return reject('INTERACTION_SCOPE_CHANNEL', 'page/channel mismatch');
    if (!(row.options || []).some((o) => o.option_id === optionId)) return reject('INTERACTION_OPTION_UNKNOWN', 'option not offered');
    if (new Date(row.expires_at) <= new Date()) {
        await Model.update({ status: 'EXPIRED', updated_at: nowIso() }, { where: { id: row.id, status: contract.LIVE_STATUSES }}).catch(() => {});
        return reject('INTERACTION_EXPIRED', 'choice expired');
    }

    // Bound business state must still be the exact thing the customer saw.
    if (row.bound_entity_type === 'order_session') {
        const OrderSessionService = require('../order/order-session-standalone.service');
        const session = await OrderSessionService.getSessionForInteraction(row.bound_entity_id, row.shop_id);
        if (!session || !['ACTIVE', 'SUSPENDED'].includes(session.status)) {
            return reject('INTERACTION_STALE_CONTEXT', 'bound session no longer live');
        }
        if (asString(session.id) !== asString(row.bound_entity_id)) return reject('INTERACTION_SCOPE_SESSION', 'session mismatch');
        if (row.bound_context_version && contextVersionFor(session) !== row.bound_context_version) {
            return reject('INTERACTION_STALE_CONTEXT', 'order state changed — fresh confirmation required');
        }
    }

    // Exactly-once claim: live -> EXECUTING.
    const [claimed] = await Model.update(
        { status: 'EXECUTING', resolution: { option_id: optionId, claimed_at: nowIso() }, updated_at: nowIso() },
        { where: { id: row.id, status: ['GENERATED', 'SENT'] }, returning: false },
    );
    if (!claimed) {
        // Replayed tap (double webhook / second click): no-op, no side effect.
        return reject('INTERACTION_ALREADY_HANDLED', 'already handled');
    }

    try {
        const outcome = await dispatch({
            row, optionId, shopId, conversation, conversationId,
            customerChannelId, metaChannelId, mutationsAllowed,
            platform, recipientId, turnId, turnStartedAt, traceId,
        });
        await Model.update(
            { status: 'CONSUMED', resolution: { option_id: optionId, outcome: outcome.meta || null, resolved_at: nowIso() }, updated_at: nowIso() },
            { where: { id: row.id } },
        );
        metrics.increment('interaction.consumed');
        return { resolved: true, response: outcome.response, meta: { interaction: row.kind, option: optionId, ...(outcome.meta || {}) } };
    } catch (error) {
        // Handler failure must not strand the row in EXECUTING forever:
        // roll it back to live so the customer may retry or type instead.
        await Model.update({ status: 'SENT', updated_at: nowIso() }, { where: { id: row.id, status: 'EXECUTING' } }).catch(() => {});
        metrics.increment('interaction.dispatch_failed');
        logger.error('interaction_dispatch_failed', error, { interactionId: row.id, optionId });
        return reject('INTERACTION_EXECUTION_FAILED', error.message);
    }
}

// Exactly-once note: the conditional GENERATED|SENT -> EXECUTING update above
// is the true fence (same pattern as draft approve); no pessimistic lock.

// ─── Operations: canonical typed-equivalents, existing authorities only ──────
async function dispatch({
    row, optionId, shopId, conversation, conversationId,
    customerChannelId, metaChannelId, mutationsAllowed,
    platform, recipientId, turnId, turnStartedAt, traceId,
}) {
    const OrderSessionService = require('../order/order-session-standalone.service');
    const language = row.language === 'en' ? 'en' : 'bn';
    const pick = (bn, en) => (language === 'en' ? en : bn);

    switch (optionId) {
        case 'delivery.info': {
            const zones = await OrderSessionService.getShopDeliveryZones(shopId);
            return { response: OrderSessionService.buildDeliveryZonePrompt(zones, language) };
        }
        case 'support.human': {
            const { escalateToHuman } = require('../conversation/human-handoff.service');
            await escalateToHuman({
                conversation, shopId, conversationId, turnId, turnStartedAt,
                platform, recipientId: recipientId || customerChannelId,
                channel: 'messenger', reason: 'customer_choice_support',
            });
            return {
                response: pick(
                    'আমাদের টিম শীঘ্রই উত্তর দেবে। 🙏',
                    'A team member will reply as soon as possible. 🙏',
                ),
                meta: { handoff: true },
            };
        }
        case 'checkout.review': {
            const session = await OrderSessionService.getSessionForInteraction(row.bound_entity_id, shopId);
            if (!session) return { response: pick('এই অর্ডারটি আর সক্রিয় নেই।', 'This order is no longer active.') };
            return { response: OrderSessionService.generateOrderSummary(session, session.step_data || {}, language) };
        }
        case 'checkout.change': {
            // Mirrors the typed path: edits are free text recognized by the
            // machine (detectCartEdit); we prompt for it, changing nothing.
            return {
                response: pick(
                    'কী পরিবর্তন করতে চান লিখে পাঠান — যেমন “প্রথমটা বাদ দিন” বা “সংখ্যা ২ করুন”।',
                    'Tell me what to change — for example “remove the first one” or “make quantity 2”.',
                ),
            };
        }
        case 'checkout.cancel': {
            // Exact typed-cancel equivalent: goes through the gated session
            // cancel (Action Gate + conditional state) with the SAME
            // mutationsAllowed context a typed cancel receives.
            try {
                await OrderSessionService.cancelSession(row.bound_entity_id, shopId, {
                    conversationId, traceId, mutationsAllowed,
                });
                return { response: pick('অর্ডারটি বাতিল করা হলো।', 'Your order has been cancelled.'), meta: { cancelled: true } };
            } catch (_) {
                return {
                    response: pick('অর্ডারটি নিরাপদে বাতিল করা যায়নি — আমাদের টিম দেখবে।', 'Could not cancel safely — our team will check.'),
                    meta: { cancel_failed: true },
                };
            }
        }
        case 'checkout.confirm': {
            const step = await OrderSessionService.processStep(
                row.bound_entity_id, shopId, 'confirm', null,
                { mutationsAllowed, conversationId, traceId },
            );
            return { response: step.prompt, meta: { completed: !!step.completed, mutation_blocked: !!step.mutation_blocked, order: step.order || null } };
        }
        case 'support.wait': {
            return { response: pick('ধন্যবাদ! আমরা আপনার বার্তার অপেক্ষায় আছি।', 'Thank you — we are here. A team member will take over soon.') };
        }
        case 'support.continue': {
            if (row.bound_entity_type === 'order_session' && row.bound_entity_id) {
                const r = await OrderSessionService.resumeSession(row.bound_entity_id, shopId, { conversationId }).catch(() => ({ resumed: false }));
                if (r?.resumed) return { response: r.prompt, meta: { resumed_step: r.current_step } };
            }
            return { response: pick('বলুন, কীভাবে সাহায্য করতে পারি?', 'Sure — how can I help?') };
        }
        case 'checkout.resume': {
            const r = await OrderSessionService.resumeSession(row.bound_entity_id, shopId, { conversationId });
            if (!r?.resumed) {
                return { response: pick('আপনার অর্ডারটি আর সক্রিয় নেই — নতুন করে শুরু করি?', 'Your order is no longer active — shall we start again?') };
            }
            return { response: r.prompt, meta: { resumed_step: r.current_step } };
        }
        case 'checkout.later': {
            return { response: pick('ঠিক আছে — যখন ইচ্ছে “চালিয়ে দিন” লিখলেই অর্ডার সেখানে থেকে চলবে।', 'No problem — type “continue” whenever you like and your order will pick up right here.') };
        }
        default:
            throw new Error(`unmapped operation ${optionId}`);
    }
}

/**
 * Free-text numbered equivalence ("2") against a live proposal — the D5
 * collision rule: NEVER consulted when the proposal binds to a capture step
 * (COLLECTING_*), where digits are legitimate field answers (quantity, zone).
 * Returns null when no live proposal may answer a bare number.
 */
async function findNumberedLivePayload({ shopId, conversationId, number }) {
    const n = parseInt(number, 10);
    if (!Number.isInteger(n) || n < 1 || n > contract.MAX_QUICK_REPLIES) return null;
    const Model = Interaction();
    const rows = await Model.findAll({
        where: {
            shop_id: shopId,
            conversation_id: conversationId,
            status: ['GENERATED', 'SENT'],
            expires_at: { [require('sequelize').Op.gt]: new Date() },
        },
        order: [['updated_at', 'DESC']],
    });
    for (const row of rows) {
        const version = String(row.bound_context_version || '');
        // D5 collision rule: digits are real field answers on capture steps.
        if (version.startsWith('COLLECTING_')) continue;
        const option = (row.options || [])[n - 1];
        if (option) return buildPayload(row.id, option.option_id);
    }
    return null;
}

module.exports = {
    CONTRACT_VERSION: contract.CONTRACT_VERSION,
    KINDS,
    createProposal,
    markSent,
    renderQuickReplies,
    resolveInteraction,
    findNumberedLivePayload,
    parsePayload,
    buildPayload,
    contextVersionFor,
};
