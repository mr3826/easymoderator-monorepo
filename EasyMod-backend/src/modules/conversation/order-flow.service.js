/**
 * Order-flow bridge
 * ─────────────────
 * Wires the deterministic order step-machine (order-session-standalone.service)
 * into the live message pipeline. The worker calls handleOrderFlow() BEFORE the
 * conversational LLM so that:
 *
 *   1. While an order session is ACTIVE, every customer message is routed to the
 *      step machine (name → phone → address → zone → payment → confirm → Order).
 *      The LLM is skipped so order data is captured reliably and an Order row is
 *      actually created on confirmation.
 *   2. When there is no active session and the customer shows clear PURCHASE
 *      intent for a product we can confidently identify, a session is started
 *      with that product linked.
 *
 * Everything else returns { handled: false } and falls through to the normal
 * conversational AI (product/price questions, greetings, FAQs, etc.).
 *
 * Why this exists: the production Messenger/IG path
 * (webhook → burst-coalescer → message-worker → processNewIntent → intentRouter)
 * was purely conversational — it never started or continued an order session, so
 * the bot "took" the customer's name/phone/address as chat (and even claimed the
 * order was confirmed) while no Order was ever created.
 */

const OrderSessionService = require('../order/order-session-standalone.service');
const productSearch = require('../product/product-search.service');
const Customer = require('../customer/customer.entity');
const {
    CANCEL_PATTERNS,
    EXACT_CANCEL_PHRASES,
    PURCHASE_PATTERNS,
    STATUS_HINTS,
    hasPurchaseIntent,
    isNegatedCancel,
    isNegatedMutation,
    isNegatedPurchase,
    isOrderCancel,
    normalizeForCancel,
    normalizeForIntent,
    classify,
} = require('../ai/intent/stage2-rules');

// P+04 interruption classes — a mid-checkout message is never "just an answer"
// when it is clearly a question, a handoff request, or about a DIFFERENT order.
const TERMINAL_CANCEL_INTENTS = new Set([
    'STOP_OPT_OUT',
    'ORDER_SESSION_CANCEL',
]);
const HANDOFF_PAUSE_INTENTS = new Set([
    'HUMAN_HANDOFF_REQUEST',
    'SENTIMENT_HANDOFF',
]);
const INFORMATIONAL_DEFER_INTENTS = new Set([
    'DELIVERY_POLICY',
    'DELIVERY_CHARGE',
    'PAYMENT_POLICY',
    'PAYMENT_METHODS',
    'FAQ_KNOWLEDGE_QUESTION',
    'PRODUCT_INQUIRY',
    'PRODUCT_ATTRIBUTE',
    'PRODUCT_AVAILABILITY',
    'PRODUCT_PHOTO_LOOKUP',
    'SELF_MFS_PAYMENT_VERIFICATION',
]);
// Truth about EXISTING orders must not destroy a NEW checkout in progress.
const ORDER_TRUTH_DEFER_INTENTS = new Set([
    'ORDER_STATUS_LOOKUP',
    'ORDER_POST_PURCHASE_REQUEST',
]);
const RESUME_PHRASE = /^(?:continue|next|resume|back|chalu|chalao|agho[ui]n|এগিয়ে|আবার শুরু|ok(?:ay)?|yes|ha|হ্যাঁ|1)[\s!.]*$/i;

// ── Intent detection ────────────────────────────────────────────────────────
// Conservative on purpose: only DECISION-to-buy phrases, never mere interest
// ("price?", "available?"). Linking the wrong product to an order — or trapping
// a browsing customer in a checkout flow — is worse than asking one more question.
// ── Helpers ───────────────────────────────────────────────────────────────-
// Facebook is stored as channel_type 'messenger' (webhook mapping facebook→messenger).
const channelTypeFor = (platform) =>
    (platform === 'facebook' || platform === 'messenger') ? 'messenger' : (platform || 'messenger');

async function resolveCustomerId(shopId, platform, channelUserId, metaChannelId = null) {
    try {
        const where = {
            shop_id: shopId,
            channel_type: channelTypeFor(platform),
            channel_user_id: String(channelUserId),
        };
        const c = await Customer.findOne({
            where: { ...where, meta_channel_id: metaChannelId || null },
            attributes: ['id'],
        });
        return c?.id || null;
    } catch {
        return null; // best-effort — order can still be created without a linked customer
    }
}

function cancelMessage(language) {
    // Single language, matching the customer: Bengali for bn/mixed/Banglish, English only for en.
    return language === 'en'
        ? "No problem, I've cancelled that order. Let me know if you need anything else! 😊"
        : 'ঠিক আছে, অর্ডারটি বাতিল করা হলো। আর কিছু লাগলে জানাবেন! 😊';
}

// ── Main entry ───────────────────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {string} params.shopId
 * @param {string} params.customerChannelId  - platform user id (PSID / IGSID)
 * @param {string} params.platform           - 'facebook' | 'messenger' | 'instagram'
 * @param {string} params.message            - effective (coalesced) customer text
 * @param {object} [params.entities]
 * @param {string} [params.language]         - 'bn' | 'en' | 'mixed'
 * @param {string[]} [params.imageUrls]
 * @param {boolean} [params.mutationsAllowed=true] - Whether ORDER_SUMMARY may create an Order
 * @param {string} [params.conversationId]
 * @param {string} [params.traceId]
 * @returns {Promise<{handled: boolean, response?: string, confidence?: number,
 *                     sourceReferences?: null, meta?: object}>}
 */
async function handleOrderFlow({
    shopId,
    customerChannelId,
    platform,
    message,
    entities = {},
    language = 'mixed',
    imageUrls = [],
    mutationsAllowed = true,
    conversationId = null,
    traceId = null,
    metaChannelId = null,
}) {
    // ── 1. Continue an active session ────────────────────────────────────────
    const safeCancellationFailure = {
        handled: true,
        response: language === 'en'
            ? 'I could not safely update that order yet. A team member will review it.'
            : 'অর্ডারটি নিরাপদে আপডেট করা যায়নি। আমাদের টিম বিষয়টি দেখে দেবে।',
        confidence: 1.0,
        sourceReferences: null,
        meta: { order_session: 'mutation_denied' },
    };
    const customerId = await resolveCustomerId(shopId, platform, customerChannelId, metaChannelId);
    const active = metaChannelId
        ? await OrderSessionService.getActiveSession(shopId, customerChannelId, metaChannelId, customerId)
        : customerId
            ? await OrderSessionService.getActiveSession(shopId, customerChannelId, null, customerId)
            : await OrderSessionService.getActiveSession(shopId, customerChannelId);
    if (active && active.status === 'ACTIVE') {
        const cancelActiveSession = async () => {
            try {
                await OrderSessionService.cancelSession(active.id, shopId, {
                    conversationId,
                    traceId,
                    mutationsAllowed,
                });
                return true;
            } catch (_) {
                return false;
            }
        };

        if (isNegatedCancel(message)) return {
            handled: true,
            response: language === 'en'
                ? 'I did not cancel or change the order.'
                : 'অর্ডারটি বাতিল বা পরিবর্তন করা হয়নি।',
            confidence: 1.0,
            sourceReferences: null,
            meta: { order_session: 'no_mutation' },
        };

        // Escape hatch: an explicit cancel ends the flow instead of being captured
        // as the answer to the current step (e.g. stored as the customer's "name").
        if (isOrderCancel(message)) {
            if (!await cancelActiveSession()) return { ...safeCancellationFailure, meta: { order_session: 'cancel_denied' } };
            return { handled: true, response: cancelMessage(language), confidence: 1.0, sourceReferences: null,
                meta: { order_session: 'cancelled' } };
        }

        if (isNegatedPurchase(message)) {
            if (!await cancelActiveSession()) return safeCancellationFailure;
            return { handled: true, response: cancelMessage(language), confidence: 1.0, sourceReferences: null,
                meta: { order_session: 'cancelled', reason: 'negated_purchase' } };
        }

        const activeIntent = classify(message, { language });
        const intentId = activeIntent.intentId;

        // (a) Terminal: STOP / explicit session-cancel still terminate.
        if (TERMINAL_CANCEL_INTENTS.has(intentId)) {
            if (!await cancelActiveSession()) return safeCancellationFailure;
            return { handled: false, meta: { order_session: 'released_for_terminal_intent', intentId } };
        }

        // (b) Human support: PAUSE the cart (step_data preserved) and let the
        // normal pipeline create/update the single authoritative handoff (HITL).
        if (HANDOFF_PAUSE_INTENTS.has(intentId)) {
            const susp = await Promise.resolve(OrderSessionService
                .suspendSession(active.id, shopId, { reason: intentId, conversationId }))
                .catch(() => ({ suspended: false }));
            return {
                handled: false,
                meta: {
                    order_session: susp?.suspended ? 'suspended_for_handoff' : 'handoff_release_only',
                    intentId,
                    session_id: active.id,
                },
            };
        }

        // (c) Informational / other-order questions: answer from evidence via
        // the normal pipeline; the checkout step is NOT written and resumes
        // after (deterministic hint from markAwaitingResume). Exception: in
        // product-picker steps (SELECTING/ADDING/ADD_MORE) the machine is the
        // right owner of such text (numbered picks, "আর লাগবে না", product
        // searches) — deferring there would break legitimate answers.
        const PICKER_STEPS = new Set(['SELECTING_PRODUCT', 'ADDING_PRODUCT', 'ADD_MORE']);
        const deferrableNow = !PICKER_STEPS.has(active.current_step);
        if (deferrableNow && (INFORMATIONAL_DEFER_INTENTS.has(intentId) || ORDER_TRUTH_DEFER_INTENTS.has(intentId))) {
            const defer = await Promise.resolve(OrderSessionService
                .markAwaitingResume(active.id, shopId, { step: active.current_step }))
                .catch(() => ({ deferred: false }));
            return {
                handled: false,
                meta: {
                    order_session: 'question_deferred',
                    intentId,
                    resume_step: active.current_step,
                    resume_hint: defer?.resume_hint || null,
                    session_id: active.id,
                },
            };
        }

        if (isNegatedMutation(message)) {
            return {
                handled: true,
                response: language === 'en'
                    ? 'I did not change the order. Tell me what you would like to do next.'
                    : 'অর্ডারে কোনো পরিবর্তন করা হয়নি। এরপর কী করতে চান জানালে বলুন।',
                confidence: 1.0,
                sourceReferences: null,
                meta: { order_session: 'no_mutation' },
            };
        }

        const rawMessage = imageUrls.length ? { imageUrl: imageUrls[0] } : null;
        const stepOptions = { mutationsAllowed };
        if (conversationId) stepOptions.conversationId = conversationId;
        if (traceId) stepOptions.traceId = traceId;
        let step;
        try {
            step = await OrderSessionService.processStep(
                active.id,
                shopId,
                message,
                rawMessage,
                stepOptions
            );
        } catch (_) {
            return {
                handled: true,
                response: language === 'en'
                    ? 'I could not safely update the order yet. A team member will review it.'
                    : 'অর্ডারটি নিরাপদে আপডেট করা যায়নি। আমাদের টিম বিষয়টি দেখে দেবে।',
                confidence: 1.0,
                sourceReferences: null,
                meta: { order_session: 'mutation_denied' },
            };
        }
        if (step && step.question_deferred) {
            // Belt (step machine refused to store a question as field data):
            // same deferral path so the pipeline answers and the step resumes.
            const defer = await Promise.resolve(OrderSessionService
                .markAwaitingResume(active.id, shopId, { step: step.current_step }))
                .catch(() => ({ deferred: false }));
            return {
                handled: false,
                meta: {
                    order_session: 'question_deferred',
                    intentId: 'question_shape_belt',
                    resume_step: step.current_step,
                    resume_hint: defer?.resume_hint || null,
                },
            };
        }
        return {
            handled: true,
            response: step.prompt,
            confidence: 1.0,
            sourceReferences: null,
            meta: {
                order_session: 'continue',
                session_id: active.id,
                step: step.current_step,
                state: step.state || null,
                completed: !!step.completed,
                mutation_blocked: !!step.mutation_blocked,
                order: step.order || null,
            },
        };
    }

    // ── 1b. Resume a SUSPENDED session (P+04: human handoff / interruption) ──
    // A suspended cart is preserved step_data. A brand-new explicit purchase
    // request is allowed past it (below) — otherwise any reply would be forced
    // back into the old checkout.
    if (!hasPurchaseIntent(message)) {
        const resumable = metaChannelId
            ? await OrderSessionService.getResumableSession(shopId, customerChannelId, metaChannelId, customerId)
            : customerId
                ? await OrderSessionService.getResumableSession(shopId, customerChannelId, null, customerId)
                : await OrderSessionService.getResumableSession(shopId, customerChannelId);
        if (resumable) {
            const suspendedIntent = classify(message, { language }).intentId;

            if (suspendedIntent === 'STOP_OPT_OUT') {
                // STOP stays terminal even while suspended — and is released to
                // the pipeline like the ACTIVE path so opt-out handling owns the
                // customer-facing confirmation.
                try {
                    await OrderSessionService.cancelSession(resumable.id, shopId, {
                        conversationId, traceId, mutationsAllowed,
                    });
                    return { handled: false, meta: { order_session: 'released_for_terminal_intent', intentId: suspendedIntent } };
                } catch (_) {
                    return { ...safeCancellationFailure, meta: { order_session: 'cancel_denied' } };
                }
            }
            if (isOrderCancel(message) || isNegatedPurchase(message)) {
                try {
                    await OrderSessionService.cancelSession(resumable.id, shopId, {
                        conversationId, traceId, mutationsAllowed,
                    });
                    return { handled: true, response: cancelMessage(language), confidence: 1.0,
                        sourceReferences: null, meta: { order_session: 'cancelled' } };
                } catch (_) {
                    return { ...safeCancellationFailure, meta: { order_session: 'cancel_denied' } };
                }
            }

            const suspendedStep = resumable.current_step;
            if (suspendedIntent === 'HUMAN_HANDOFF_REQUEST' || suspendedIntent === 'SENTIMENT_HANDOFF') {
                return { handled: false, meta: { order_session: 'already_suspended', intentId: suspendedIntent } };
            }
            if (INFORMATIONAL_DEFER_INTENTS.has(suspendedIntent) || ORDER_TRUTH_DEFER_INTENTS.has(suspendedIntent)) {
                const defer = await Promise.resolve(OrderSessionService
                    .markAwaitingResume(resumable.id, shopId, { step: suspendedStep }))
                    .catch(() => ({ deferred: false }));
                return {
                    handled: false,
                    meta: {
                        order_session: 'question_deferred',
                        intentId: suspendedIntent,
                        resume_step: suspendedStep,
                        resume_hint: defer?.resume_hint || null,
                    },
                };
            }

            if (RESUME_PHRASE.test(String(message).trim())) {
                const resumed = await Promise.resolve(OrderSessionService
                    .resumeSession(resumable.id, shopId, { conversationId }))
                    .catch(() => ({ resumed: false }));
                if (resumed?.resumed) {
                    return {
                        handled: true,
                        response: resumed.prompt,
                        confidence: 1.0,
                        sourceReferences: null,
                        meta: { order_session: 'resumed', step: resumed.current_step },
                    };
                }
            }

            // Otherwise this reply IS the next answer of the preserved step:
            // resume first (so processStep's ACTIVE filter accepts it), then
            // feed the message to the machine unchanged.
            await Promise.resolve(OrderSessionService.resumeSession(resumable.id, shopId, { conversationId })).catch(() => {});
            const rawMessage = imageUrls.length ? { imageUrl: imageUrls[0] } : null;
            const stepOptions = { mutationsAllowed };
            if (conversationId) stepOptions.conversationId = conversationId;
            if (traceId) stepOptions.traceId = traceId;
            try {
                const step = await OrderSessionService.processStep(
                    resumable.id, shopId, message, rawMessage, stepOptions,
                );
                return {
                    handled: true,
                    response: step.prompt,
                    confidence: 1.0,
                    sourceReferences: null,
                    meta: {
                        order_session: 'continue',
                        resumed_from_suspension: true,
                        step: step.current_step,
                        state: step.state || null,
                        completed: !!step.completed,
                        mutation_blocked: !!step.mutation_blocked,
                        order: step.order || null,
                    },
                };
            } catch (_) {
                return safeCancellationFailure;
            }
        }
    }

    // ── 2. Start a session on clear purchase intent for an identified product ─
    if (classify(message, { language, activeSession: true }).intentId === 'ORDER_SESSION_CHECKOUT') {
        return {
            handled: true,
            response: language === 'en'
                ? 'There is no active order to check out. Send the product name with your order request first.'
                : 'চেকআউট করার কোনো সক্রিয় অর্ডার নেই। আগে পণ্যের নাম দিয়ে অর্ডারের অনুরোধ পাঠান।',
            confidence: 1.0,
            sourceReferences: null,
            meta: { order_session: 'checkout_requires_active_session' },
        };
    }
    if (isNegatedPurchase(message) || isNegatedMutation(message)) {
        return {
            handled: true,
            response: language === 'en'
                ? 'I did not start or change an order.'
                : 'কোনো অর্ডার শুরু বা পরিবর্তন করা হয়নি।',
            confidence: 1.0,
            sourceReferences: null,
            meta: { order_session: 'no_mutation' },
        };
    }
    if (!hasPurchaseIntent(message)) {
        return { handled: false };
    }

    let { products, wasFallback } = await productSearch
        .searchForOrder({ shopId, query: message, limit: 5 })
        .catch(() => ({ products: [], wasFallback: true }));

    // The dominant F-commerce buy signal is a product PHOTO + "order korbo" —
    // the text carries no product name, so text search finds nothing. Identify
    // the product from the image instead (CLIP/RAG/Vision, already thresholded).
    if ((wasFallback || !products.length) && imageUrls.length) {
        try {
            const { matchImageMessage } = require('../ai/image-product-matcher.service');
            const imageMatch = await matchImageMessage({ shopId, imageUrl: imageUrls[0], text: message });
            if (imageMatch.products?.length) {
                products = imageMatch.products;
                wasFallback = false;
            }
        } catch (_) { /* image matching is best-effort — fall through to the LLM */ }
    }

    // No confident product match → ask which item, deterministically. Falling
    // through to the LLM here is what produced the live 2026-06-11 failure:
    // on "evan, order korbo" it role-played "amader system ekhon apnar order
    // process ta shuru korbe" while no session existed at all.
    if (wasFallback || !products.length) {
        return {
            handled: true,
            response: language === 'en'
                ? 'Which product would you like to order? Send the product name or a photo and I\'ll start your order 😊'
                : 'কোন প্রোডাক্টটি অর্ডার করতে চান? প্রোডাক্টের নাম লিখে অথবা ছবি পাঠালে অর্ডারটি শুরু করে দিচ্ছি 😊',
            confidence: 1.0,
            sourceReferences: null,
            meta: { order_session: 'product_needed' },
        };
    }

    const channel = channelTypeFor(platform);

    const startArgs = {
        shop_id: shopId,
        customer_id: customerId,
        customer_channel_id: customerChannelId,
        ...(metaChannelId ? { meta_channel_id: metaChannelId } : {}),
        channel,
        initial_message: message,
        entities,
        language,
    };

    if (products.length === 1) {
        const p = products[0];
        startArgs.product_info = { id: p.id, name: p.name, name_bn: p.name_bn || null, price: p.price, quantity: 1 };
    } else {
        startArgs.product_candidates = products.slice(0, 5).map(p => ({
            id: p.id,
            name: p.name,
            name_bn: p.name_bn || null,
            price: p.price,
            in_stock: p.in_stock,
        }));
    }

    const sessionResult = await OrderSessionService.startOrderSession(startArgs);
    return {
        handled: true,
        response: sessionResult.prompt,
        confidence: 1.0,
        sourceReferences: null,
        meta: { order_session: sessionResult.session_id ? 'started' : 'not_started', out_of_stock: !!sessionResult.out_of_stock },
    };
}

module.exports = {
    handleOrderFlow,
    hasPurchaseIntent,
    isOrderCancel,
    // Compatibility exports for callers that imported the old rule helpers.
    PURCHASE_PATTERNS,
    STATUS_HINTS,
    EXACT_CANCEL_PHRASES,
    CANCEL_PATTERNS,
    normalizeForIntent,
    normalizeForCancel,
};
