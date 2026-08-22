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
    isOrderCancel,
    normalizeForCancel,
    normalizeForIntent,
} = require('../ai/intent/stage2-rules');

// ── Intent detection ────────────────────────────────────────────────────────
// Conservative on purpose: only DECISION-to-buy phrases, never mere interest
// ("price?", "available?"). Linking the wrong product to an order — or trapping
// a browsing customer in a checkout flow — is worse than asking one more question.
// ── Helpers ───────────────────────────────────────────────────────────────-
// Facebook is stored as channel_type 'messenger' (webhook mapping facebook→messenger).
const channelTypeFor = (platform) =>
    (platform === 'facebook' || platform === 'messenger') ? 'messenger' : (platform || 'messenger');

async function resolveCustomerId(shopId, platform, channelUserId) {
    try {
        const c = await Customer.findOne({
            where: {
                shop_id: shopId,
                channel_type: channelTypeFor(platform),
                channel_user_id: String(channelUserId),
            },
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
}) {
    // ── 1. Continue an active session ────────────────────────────────────────
    const active = await OrderSessionService.getActiveSession(shopId, customerChannelId);
    if (active && active.status === 'ACTIVE') {
        // Escape hatch: an explicit cancel ends the flow instead of being captured
        // as the answer to the current step (e.g. stored as the customer's "name").
        if (isOrderCancel(message)) {
            try { await OrderSessionService.cancelSession(active.id, shopId); } catch (_) { /* best-effort */ }
            return { handled: true, response: cancelMessage(language), confidence: 1.0, sourceReferences: null,
                meta: { order_session: 'cancelled' } };
        }

        const rawMessage = imageUrls.length ? { imageUrl: imageUrls[0] } : null;
        const stepOptions = { mutationsAllowed };
        if (conversationId) stepOptions.conversationId = conversationId;
        if (traceId) stepOptions.traceId = traceId;
        const step = await OrderSessionService.processStep(
            active.id,
            shopId,
            message,
            rawMessage,
            stepOptions
        );
        return {
            handled: true,
            response: step.prompt,
            confidence: 1.0,
            sourceReferences: null,
            meta: {
                order_session: 'continue',
                step: step.current_step,
                state: step.state || null,
                completed: !!step.completed,
                mutation_blocked: !!step.mutation_blocked,
                order: step.order || null,
            },
        };
    }

    // ── 2. Start a session on clear purchase intent for an identified product ─
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

    const customerId = await resolveCustomerId(shopId, platform, customerChannelId);
    const channel = channelTypeFor(platform);

    const startArgs = {
        shop_id: shopId,
        customer_id: customerId,
        customer_channel_id: customerChannelId,
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
