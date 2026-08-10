'use strict';

/**
 * Product evidence — turns retrieval output into VERIFIED PRODUCT ENTITIES.
 *
 * The production incident came from treating a SEARCH CANDIDATE as proof that a
 * product exists. product-search runs an OR-semantics tsquery, so "chiffon saree
 * ache?" happily returns every saree in the catalog; those rows were then handed
 * to the model under the header "use ONLY these facts", and the model concluded
 * the shop sells chiffon sarees.
 *
 * The rule here is conjunctive, not statistical: a candidate is VERIFIED only
 * when EVERY product-identifying term the customer supplied is present in that
 * product's structured catalog fields. "black saree" verifies against
 * "Premium Black Saree"; "chiffon saree" does not. There is no tuned similarity
 * threshold to drift, and the evidence records exactly which terms matched.
 *
 * Shop isolation: every row here comes from a query already scoped by shop_id
 * (product-search.service), and resolveProductMedia re-asserts ownership before
 * a URL can leave this module.
 */

const {
    ProductEvidenceStatus,
    FactState,
    MediaStatus,
    emptyEvidence,
    withSourceText,
} = require('./grounding.contract');

/**
 * Terms that express *intent*, not product identity. Removing them is what
 * makes conjunctive matching usable: "ei black saree ta ache?" identifies a
 * product by {black, saree}, not by {ei, ta, ache}. Anything left after this
 * filter is treated as a claim about the product and must be satisfied.
 */
const INTENT_STOPWORDS = new Set([
    // English question/intent words
    'a', 'an', 'the', 'is', 'are', 'do', 'does', 'you', 'your', 'we', 'i', 'me', 'my',
    'have', 'has', 'any', 'this', 'that', 'it', 'its', 'in', 'of', 'for', 'to', 'and',
    'or', 'with', 'what', 'which', 'how', 'much', 'many', 'price', 'cost', 'stock',
    'available', 'availability', 'buy', 'order', 'purchase', 'want', 'need', 'looking',
    'show', 'send', 'give', 'please', 'picture', 'pictures', 'photo', 'photos', 'pic',
    'pics', 'image', 'images', 'there', 'got', 'can', 'could', 'would', 'will', 'be',
    'ok', 'okay', 'yes', 'no', 'sure', 'again', 'check', 'try', 'really', 'still',
    'delivery', 'shipping', 'discount', 'offer', 'product', 'products', 'item', 'items',
    // Attribute NAMES. Asking "what colour is it?" names the question, not the
    // product — "panjabi er color ki?" identifies a panjabi, not a "color".
    // Attribute VALUES ("black", "cotton") stay identifying, so "red saree"
    // is still matched conjunctively.
    'color', 'colour', 'material', 'fabric', 'size', 'sizes', 'weight', 'length',
    // Banglish
    // 'er'/'ar'/'r' are genitive particles ("panjabi ER color") — grammar, not
    // identity. Left in, they made every possessive phrasing report NOT_FOUND
    // for a product the shop plainly sells.
    'er', 'ar', 'kapor', 'kapod', 'rong', 'rang', 'maap',
    'ache', 'achhe', 'ase', 'ashe', 'nai', 'nei', 'ki', 'kina', 'koto', 'kotto',
    'daam', 'dam', 'taka', 'takar', 'lagbe', 'nibo', 'niba', 'chai', 'dekhao',
    'dekhan', 'den', 'den', 'pabo', 'paoa', 'pawa', 'ei', 'eta', 'ota', 'ta', 'ti',
    'tar', 'amar', 'apnar', 'apni', 'ami', 'kore', 'koren', 'korbo', 'abar', 'plz',
    'chobi', 'chobita', 'sure', 'to', 'na', 'hobe', 'hoy', 'kemon', 'onek', 'kichu',
    // Bengali script
    'দাম', 'মূল্য', 'কত', 'টাকা', 'দেখান', 'দেখাও', 'আছে', 'নাই', 'নেই', 'কি', 'কী',
    'কিনব', 'কিনবো', 'লাগবে', 'চাই', 'অর্ডার', 'এই', 'এটা', 'ওটা', 'টা', 'টি',
    'আমার', 'আপনার', 'আপনি', 'আমি', 'ছবি', 'ছবিটা', 'দিন', 'দেন', 'করেন', 'আবার',
    'একটা', 'একটি', 'কোন', 'কোনো', 'হবে', 'হয়', 'এবং', 'ও', 'তো', 'না', 'জন্য',
    'পাব', 'পাবো', 'নিব', 'নিবো', 'স্টক', 'ডেলিভারি', 'ছাড়', 'অফার', 'প্রোডাক্ট',
    'রং', 'রঙ', 'কাপড়', 'সাইজ', 'মাপ',
]);

/**
 * Bengali ⇄ English equivalences for the product nouns BD shops actually sell.
 * Without these, a Bengali-script query against an English-named catalog row
 * would fail conjunctive matching and report NOT_FOUND for a product the shop
 * really has — safe, but needlessly unhelpful. Deliberately small: only pairs
 * where the mapping is unambiguous.
 */
const TERM_EQUIVALENTS = new Map(Object.entries({
    'শাড়ি': 'saree', 'শাড়ী': 'saree', 'sari': 'saree', 'shari': 'saree',
    'পাঞ্জাবি': 'panjabi', 'punjabi': 'panjabi', 'পাঞ্জাবী': 'panjabi',
    'কুর্তি': 'kurti', 'কামিজ': 'kameez', 'সালোয়ার': 'salwar',
    'শার্ট': 'shirt', 'টিশার্ট': 'tshirt', 't-shirt': 'tshirt',
    'জামা': 'dress', 'ড্রেস': 'dress', 'ফ্রক': 'frock',
    'ব্যাগ': 'bag', 'জুতা': 'shoes', 'জুতো': 'shoes',
    'লাল': 'red', 'নীল': 'blue', 'কালো': 'black', 'সাদা': 'white',
    'সবুজ': 'green', 'হলুদ': 'yellow', 'গোলাপি': 'pink',
    'সুতি': 'cotton', 'সিল্ক': 'silk', 'শিফন': 'chiffon', 'জর্জেট': 'georgette',
    'মসলিন': 'muslin', 'জামদানি': 'jamdani',
}));

/**
 * Attribute vocabulary. Two jobs: decide which attribute the customer asked
 * about, and let the outbound gate detect an asserted value for an attribute
 * the catalog records as UNKNOWN.
 */
const ATTRIBUTE_VOCABULARY = Object.freeze({
    material: [
        'chiffon', 'silk', 'cotton', 'georgette', 'muslin', 'jamdani', 'linen',
        'polyester', 'velvet', 'satin', 'denim', 'rayon', 'viscose', 'khadi',
        'organza', 'net', 'crepe', 'tissue', 'katan', 'half-silk', 'halfsilk',
        'শিফন', 'সিল্ক', 'সুতি', 'জর্জেট', 'মসলিন', 'জামদানি', 'কাতান',
    ],
    color: [
        'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
        'orange', 'brown', 'grey', 'gray', 'maroon', 'navy', 'beige', 'golden',
        'কালো', 'সাদা', 'লাল', 'নীল', 'সবুজ', 'হলুদ', 'গোলাপি', 'খয়েরি',
    ],
    size: ['size', 'sizes', 'small', 'medium', 'large', 'xl', 'xxl', 'সাইজ', 'মাপ'],
});

/** Does the customer's message request a product photo? */
const MEDIA_REQUEST_PATTERN =
    /\b(picture|pictures|photo|photos|pic|pics|image|images|chobi|chobita|snap)\b|ছবি|পিক/i;

const isMediaRequest = (message) =>
    typeof message === 'string' && MEDIA_REQUEST_PATTERN.test(message);

/**
 * Bengali case suffixes and the English plural. "জামার দাম" inflects জামা, and
 * "sarees" pluralises saree; without stemming, conjunctive matching reports
 * NOT_FOUND for products the shop plainly sells. Safe direction to be generous
 * in: a stem still has to appear in the product's own structured fields.
 */
const BENGALI_SUFFIXES = ['গুলোর', 'গুলির', 'গুলো', 'গুলি', 'টার', 'টির', 'টা', 'টি', 'ের', 'কে', 'র', 'য়', 'ে'];

const termVariants = (term) => {
    const variants = new Set([term]);
    for (const suffix of BENGALI_SUFFIXES) {
        if (term.endsWith(suffix) && term.length - suffix.length >= 2) {
            variants.add(term.slice(0, -suffix.length));
        }
    }
    if (term.endsWith('s') && term.length >= 5) variants.add(term.slice(0, -1));
    return [...variants];
};

/**
 * Split a customer message into product-identifying terms.
 * Pure-numeric tokens are dropped: "1000 takar moddhe saree" is a budget, not a
 * product name, and treating it as an identifying claim would force NOT_FOUND
 * on a catalog that does contain sarees.
 */
const identifyingTerms = (message) => {
    if (!message || typeof message !== 'string') return [];
    const raw = message
        .toLowerCase()
        .replace(/[^\wঀ-৿\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const terms = [];
    for (const token of raw) {
        if (token.length < 2) continue;
        if (/^\d+$/.test(token)) continue;
        if (INTENT_STOPWORDS.has(token)) continue;
        // Canonicalise through the stem too, so "জামার" resolves to "dress".
        const canonical = termVariants(token)
            .map(v => TERM_EQUIVALENTS.get(v))
            .find(Boolean) || token;
        if (INTENT_STOPWORDS.has(canonical)) continue;
        if (!terms.includes(canonical)) terms.push(canonical);
    }
    return terms;
};

/**
 * The catalog text a term may be verified against.
 *
 * Structured fields only — descriptions are deliberately excluded. Marketing
 * prose ("drapes like chiffon") would verify "chiffon" against a product whose
 * recorded material is something else, which is precisely the class of claim
 * this module exists to prevent.
 */
const identityText = (product) => {
    const variantValues = Array.isArray(product.variants)
        ? product.variants.flatMap(v => [v?.size, v?.color, v?.value, v?.option]).filter(Boolean)
        : [];
    return [
        product.name,
        product.name_bn,
        product.category,
        product.brand,
        product.ai_color,
        product.ai_material,
        ...(Array.isArray(product.tags) ? product.tags : []),
        ...(Array.isArray(product.ai_tags) ? product.ai_tags : []),
        ...variantValues,
    ].filter(Boolean).join(' ').toLowerCase();
};

/** Which identifying terms does this catalog row actually satisfy? */
const matchTerms = (product, terms) => {
    const haystack = identityText(product);
    // Equivalences run both ways: a Bengali query term was canonicalised to
    // English, so an English catalog row matches; an English query term must
    // still match a Bengali catalog row.
    const alternates = (term) => {
        const out = new Set(termVariants(term));
        for (const [bn, en] of TERM_EQUIVALENTS.entries()) {
            if (en === term) out.add(bn);
        }
        return [...out];
    };
    return terms.filter(term => alternates(term).some(t => haystack.includes(t)));
};

/**
 * Which attributes did the customer ask about?
 * Drives UNKNOWN reporting ("eta chiffon?" on a product with material = NULL).
 */
const askedAttributes = (message) => {
    if (!message || typeof message !== 'string') return [];
    const lower = message.toLowerCase();
    return Object.entries(ATTRIBUTE_VOCABULARY)
        .filter(([, words]) => words.some(w => lower.includes(w)))
        .map(([attribute]) => attribute);
};

/**
 * Build the per-attribute fact table for a verified product.
 * A NULL catalog column becomes an explicit UNKNOWN rather than an omission —
 * omission is what the model read as "free to infer".
 */
const buildFacts = (product) => {
    const sizes = Array.isArray(product.variants)
        ? [...new Set(product.variants.map(v => v?.size || (v?.option === 'Size' ? v.value : null)).filter(Boolean))]
        : [];
    const colors = Array.isArray(product.variants)
        ? [...new Set(product.variants.map(v => v?.color || (v?.option === 'Color' ? v.value : null)).filter(Boolean))]
        : [];
    const known = (value) => ({ state: FactState.KNOWN, value });
    const unknown = () => ({ state: FactState.UNKNOWN, value: null });

    return {
        name: known(product.name),
        price: Number.isFinite(product.price) ? known(product.price) : unknown(),
        // quantity decides stock ONLY where the merchant counts stock. Most BD
        // shops add products without ever setting a count, which leaves
        // quantity at 0 with track_quantity false — reading that as "sold out"
        // told real customers every in-stock product was unavailable.
        stock: product.is_active === false
            ? known('DISCONTINUED')
            : known(
                product.in_stock === false
                || (product.track_quantity === true && Number(product.quantity) === 0)
                    ? 'OUT_OF_STOCK'
                    : 'IN_STOCK',
            ),
        // An untracked count is not a count. Printing "Quantity: 0" into the
        // prompt is what the model was reasoning from.
        quantity: product.track_quantity === true && Number.isFinite(product.quantity)
            ? known(product.quantity)
            : unknown(),
        material: product.ai_material ? known(product.ai_material) : unknown(),
        color: product.ai_color ? known(product.ai_color) : (colors.length ? known(colors.join(', ')) : unknown()),
        sizes: sizes.length ? known(sizes.join(', ')) : unknown(),
        brand: product.brand ? known(product.brand) : unknown(),
        category: product.category ? known(product.category) : unknown(),
    };
};

/**
 * Is this a URL we are willing to hand to Meta as a product image?
 * Absolute https only. A relative path, a data: URI or a plain http host is
 * either unreachable from Meta's fetcher or an injection surface, and a
 * product photo is never worth either risk.
 */
const isUsableMediaUrl = (url) => {
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
        const parsed = new URL(url.trim());
        return parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

/** First provenance-valid image stored on THIS product row. */
const productMediaUrl = (product) => {
    const candidates = [
        ...(Array.isArray(product.images) ? product.images : []),
        product.image_url,
    ];
    for (const candidate of candidates) {
        const url = typeof candidate === 'string' ? candidate : candidate?.url;
        if (isUsableMediaUrl(url)) return url.trim();
    }
    return null;
};

const toVerifiedProduct = (product, shopId, matched) => ({
    id: String(product.id),
    shopId,
    name: product.name,
    price: product.price,
    facts: buildFacts(product),
    matchedTerms: matched,
    imageUrl: productMediaUrl(product),
});

/**
 * Resolve authoritative product evidence for one customer turn.
 *
 * `candidates` are rows already fetched under this shop's scope. This function
 * performs no I/O — it is the pure decision layer, which is what makes the
 * VERIFIED/NOT_FOUND boundary directly testable.
 *
 * @param {object}   params
 * @param {string}   params.shopId
 * @param {string}   params.message      - the customer's message for this turn
 * @param {object[]} params.candidates   - shop-scoped rows from product-search
 * @param {boolean}  [params.retrievalFailed] - true when retrieval threw
 * @returns {import('./grounding.contract').GroundingEvidence}
 */
const resolveProductEvidence = ({ shopId, message, candidates = [], retrievalFailed = false }) => {
    const evidence = emptyEvidence(shopId);
    const terms = identifyingTerms(message);
    evidence.askedAttributes = askedAttributes(message);
    const mediaRequested = isMediaRequest(message);

    if (retrievalFailed) {
        // Truth is unknown. Never downgrade this to NOT_FOUND (which would let a
        // reply assert the shop does not sell something it may well sell) and
        // never to NONE (which would unlock free-form answering).
        evidence.productStatus = ProductEvidenceStatus.RETRIEVAL_FAILED;
        evidence.failure = 'product_retrieval_error';
        evidence.mediaStatus = mediaRequested ? MediaStatus.NO_PRODUCT : MediaStatus.NOT_REQUESTED;
        return evidence;
    }

    if (terms.length === 0) {
        // No product entity was named. Greetings, thanks, "abar check koren" on
        // its own — the reply carries no product claim to ground.
        evidence.productStatus = ProductEvidenceStatus.NONE;
        evidence.mediaStatus = mediaRequested ? MediaStatus.NO_PRODUCT : MediaStatus.NOT_REQUESTED;
        return evidence;
    }

    const verified = [];
    const related = [];
    for (const candidate of candidates) {
        if (!candidate || !candidate.id || !candidate.name) continue;
        const matched = matchTerms(candidate, terms);
        if (matched.length === terms.length) {
            verified.push(toVerifiedProduct(candidate, shopId, matched));
        } else if (matched.length > 0) {
            related.push(toVerifiedProduct(candidate, shopId, matched));
        }
    }

    evidence.verifiedProducts = verified;
    evidence.relatedProducts = related;
    evidence.productStatus = verified.length
        ? ProductEvidenceStatus.VERIFIED
        : ProductEvidenceStatus.NOT_FOUND;
    evidence.unmatchedTerms = verified.length
        ? []
        : terms.filter(t => !related.some(r => r.matchedTerms.includes(t)));

    if (!mediaRequested) {
        evidence.mediaStatus = MediaStatus.NOT_REQUESTED;
    } else if (!verified.length) {
        evidence.mediaStatus = MediaStatus.NO_PRODUCT;
    } else {
        const withMedia = verified.find(p => p.imageUrl);
        if (withMedia) {
            evidence.mediaStatus = MediaStatus.AVAILABLE;
            evidence.mediaUrl = withMedia.imageUrl;
            evidence.mediaProductId = withMedia.id;
            evidence.allowedUrls.push(withMedia.imageUrl);
        } else {
            evidence.mediaStatus = MediaStatus.UNAVAILABLE;
        }
    }

    return evidence;
};

/**
 * Is this turn a question about an attribute of the product already under
 * discussion, rather than a search for a new one?
 *
 * "eta chiffon?" names no product — the noun is in the previous turn. Treating
 * it as a search would answer "we don't sell that", which is both wrong and a
 * different claim from the truthful one ("we don't know this saree's material").
 */
const isAttributeOnlyQuery = (message) => {
    const attributes = askedAttributes(message);
    if (!attributes.length) return false;
    const attributeWords = new Set(
        attributes.flatMap(a => ATTRIBUTE_VOCABULARY[a]).map(w => w.toLowerCase()),
    );
    const terms = identifyingTerms(message);
    return terms.length > 0 && terms.every(t => attributeWords.has(t));
};

/** Does this product's recorded value for `attribute` contain the asked term? */
const satisfiesAttributeTerms = (product, terms, attributes) =>
    attributes.every((attribute) => {
        const fact = product.facts[attribute];
        if (!fact || fact.state !== FactState.KNOWN) return false;
        const recorded = String(fact.value).toLowerCase();
        const askedForThis = terms.filter(t => (ATTRIBUTE_VOCABULARY[attribute] || []).includes(t));
        return askedForThis.length > 0 && askedForThis.every(t => recorded.includes(t));
    });

/**
 * Evidence for an attribute follow-up, grounded in the products this
 * conversation has already verified (carried on the previous AI message's
 * source_references — EasyModerator only ever writes real catalog IDs there).
 *
 * With no product in context we deliberately produce NONE: asking which product
 * they mean is the only honest answer, and it is what the caller then sends.
 */
const resolveContextualAttributeEvidence = ({ shopId, message, contextProducts = [], retrievalFailed = false }) => {
    const evidence = emptyEvidence(shopId);
    evidence.askedAttributes = askedAttributes(message);
    const terms = identifyingTerms(message);

    if (retrievalFailed) {
        evidence.productStatus = ProductEvidenceStatus.RETRIEVAL_FAILED;
        evidence.failure = 'product_retrieval_error';
        return evidence;
    }
    if (!contextProducts.length) return evidence; // NONE — ask which product

    evidence.verifiedProducts = contextProducts
        .filter(p => p && p.id && p.name)
        .map(p => toVerifiedProduct(p, shopId, terms));
    if (!evidence.verifiedProducts.length) return evidence;
    evidence.productStatus = ProductEvidenceStatus.VERIFIED;

    // A photo may only accompany a confirmed "yes". If we cannot confirm the
    // attribute the customer named, sending the product's picture would present
    // it as the chiffon one they asked for.
    if (isMediaRequest(message)) {
        const match = evidence.verifiedProducts.find(p =>
            satisfiesAttributeTerms(p, terms, evidence.askedAttributes));
        if (!match) {
            evidence.mediaStatus = MediaStatus.NOT_REQUESTED;
        } else if (match.imageUrl) {
            evidence.mediaStatus = MediaStatus.AVAILABLE;
            evidence.mediaUrl = match.imageUrl;
            evidence.mediaProductId = match.id;
            evidence.allowedUrls.push(match.imageUrl);
        } else {
            evidence.mediaStatus = MediaStatus.UNAVAILABLE;
        }
    }

    return evidence;
};

/** Product IDs this conversation has already grounded, newest turn first. */
const contextProductIds = (history = []) => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const turn = history[i] || {};
        if (turn.role === 'user' || turn.role === 'customer') continue;
        const references = turn.sourceReferences || turn.source_references || [];
        const ids = (Array.isArray(references) ? references : [])
            .filter(r => r && r.kind === 'product' && r.id)
            .map(r => String(r.id));
        if (ids.length) return ids;
    }
    return [];
};

module.exports = {
    resolveProductEvidence,
    resolveContextualAttributeEvidence,
    isAttributeOnlyQuery,
    contextProductIds,
    satisfiesAttributeTerms,
    identifyingTerms,
    askedAttributes,
    isMediaRequest,
    isUsableMediaUrl,
    productMediaUrl,
    buildFacts,
    withSourceText,
    ATTRIBUTE_VOCABULARY,
};
