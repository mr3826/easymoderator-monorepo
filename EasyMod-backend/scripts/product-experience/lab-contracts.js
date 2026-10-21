'use strict';

const crypto = require('node:crypto');
const {
    parseCsv,
    validateDataset,
    normalizeInputType,
    normalizeLanguage,
    classifyExpectedTruth,
} = require('./replay');

const TENANTS = Object.freeze(['merchant-a', 'merchant-b']);
const IMAGE_FIXTURE_IDS = Object.freeze(['fixture-shirt-front', 'fixture-shirt-detail']);
const PERSONA_ID = /^P(?:0[1-9]|1\d|20)$/;
const SESSION_ID = /^session-[a-z0-9-]{1,48}$/;
const PRICE_NEGOTIATION = /\b(?:discount|offer|combo|deal|coupon|promotion|negotiable|fixed price|bargain|price negotiation)\b|\b(?:discount|offer)\s+(?:diben|dibেন)\b|\b(?:ekdam|ek\s+dam)\b|দাম\s*কম|এক\s*দাম|একদাম|ডিসকাউন্ট|ছাড়|ছাড়|অফার|ফিক্সড\s*দাম|দাম\s*নেগোশিয়েবল/iu;

const ownKeysOnly = (value, allowed, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new Error(`${label} contains unsupported fields.`);
};

const validateRunRequest = (body) => {
    ownKeysOnly(body, ['scope', 'personaId', 'mode'], 'Run request');
    if (!['persona', 'full'].includes(body.scope)) throw new Error('Run scope is invalid.');
    if (!['baseline', 'candidate'].includes(body.mode)) throw new Error('Run mode is invalid.');
    if (body.scope === 'persona') {
        if (typeof body.personaId !== 'string' || !PERSONA_ID.test(body.personaId)) {
            throw new Error('Persona run requires a known persona identifier.');
        }
    } else if (Object.hasOwn(body, 'personaId')) {
        throw new Error('Full-dataset run cannot include a persona identifier.');
    }
    return body.scope === 'persona'
        ? { scope: body.scope, personaId: body.personaId, mode: body.mode }
        : { scope: body.scope, mode: body.mode };
};

const validatePlaygroundRequest = (body) => {
    ownKeysOnly(body, ['tenantId', 'sessionId', 'message', 'imageFixtureId'], 'Playground request');
    if (!TENANTS.includes(body.tenantId)) throw new Error('Playground tenant is not a synthetic merchant.');
    if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new Error('Playground session identifier is invalid.');
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 500) {
        throw new Error('Playground message must contain 1 to 500 characters.');
    }
    if (body.imageFixtureId !== undefined && !IMAGE_FIXTURE_IDS.includes(body.imageFixtureId)) {
        throw new Error('Playground image fixture is not approved.');
    }
    return {
        tenantId: body.tenantId,
        sessionId: body.sessionId,
        message: body.message.trim(),
        imageFixtureId: body.imageFixtureId || null,
    };
};

const requestedFacts = (message) => {
    const text = String(message || '').toLocaleLowerCase();
    const asciiText = text.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
    const bodySizeFit = /\b(?:chest|bust|waist|hip)\b.{0,24}\b(?:size|measure|measurement)\b|\b(?:size|measurement)\b.{0,24}\b(?:chest|bust|waist|hip)\b|\bmy\s+(?:body|chest|bust|waist|hip)\b|\bmy\s+body\s+(?:is|size)\b|আমার\s*(?:গায়ের|বুকের|কোমরের|বডির|বডি)|গায়ের\s*(?:সাইজ|মাপ)/iu.test(text);
    const garmentMeasurement = /\b(?:length|inseam|outseam|shoulder)\b.{0,40}\b(?:inch(?:es)?|cm|measure(?:ment)?|koto|how\s+long|how\s+many)\b|\b(?:inch(?:es)?|cm|measure(?:ment)?)\b.{0,40}\b(?:length|inseam|outseam|shoulder)\b/iu.test(text);
    const surfaceFinish = /\b(?:finish|shiny|matte|glossy|sheen|texture)\b|চকচকে|ম্যাট\s*ফিনিশ/iu.test(text);
    const facts = [];
    const durationQuestion = /\b(?:koto\s*din|kotodin|how long|how many days?)\b|কত\s*দিন|কতদিন|কয়\s*দিন|কয়দিন/iu.test(text);
    const asksPrice = !PRICE_NEGOTIATION.test(text) && (/\b(?:price|cost|dam|daam|current\s+price)\b|দাম|মূল্য/iu.test(text)
        || (!bodySizeFit && !garmentMeasurement && !durationQuestion && /\b(?:how much|koto)\b|কত/iu.test(text)));
    if (asksPrice) facts.push('price');
    if (!bodySizeFit && /\b(stock|available|availability|in stock|out of stock|quantity)\b|স্টক|পাওয়া যাবে|আছে/i.test(text)) facts.push('stock');
    if (!surfaceFinish && /\b(material|fabric|cotton|silk|linen)\b|কাপড়|উপাদান/i.test(text)) facts.push('material');
    if (/\b(color|colour|shade)\b|রং/i.test(text)) facts.push('color');
    if (!bodySizeFit && !garmentMeasurement && (/\b(size|sizes|variant|option)\b|সাইজ/i.test(text) || /\bw\s?\d{2}\b/i.test(asciiText))) facts.push('variant');
    return facts;
};

const unsupportedRequestedFacts = (message) => {
    const text = String(message || '').toLocaleLowerCase();
    const facts = [];
    if (/\b(pocket|pockets)\b|পকেট/i.test(text)) facts.push('pocket_count');
    if (/\b(fit|fitting|cut|tailoring)\b|ফিটিং|ফিট/i.test(text)) facts.push('fit');
    if (/\b(included|includes|comes with|bundle|set contents)\b|সাথে কী|সেটের মধ্যে/i.test(text)) facts.push('included_items');
    if (/\b(?:matching|match|go with|goes with|pair with|pairing|accessory|accessories)\b|\bwith\s+(?:a\s+)?(?:matching\s+)?(?:orna|koti|scarf|dupatta)\b|সাথে\s*(?:মিল|ম্যাচ)|ম্যাচিং\s*(?:ওড়না|ওড়না|কটি)/iu.test(text)) facts.push('accessory_compatibility');
    if (/\b(?:finish|shiny|matte|glossy|sheen|texture)\b|চকচকে|ম্যাট\s*ফিনিশ/iu.test(text)) facts.push('surface_finish');
    if (/\b(?:chest|bust|waist|hip)\b.{0,24}\b(?:size|measure|measurement)\b|\b(?:size|measurement)\b.{0,24}\b(?:chest|bust|waist|hip)\b|\bmy\s+(?:body|chest|bust|waist|hip)\b|\bmy\s+body\s+(?:is|size)\b|আমার\s*(?:গায়ের|বুকের|কোমরের|বডির|বডি)|গায়ের\s*(?:সাইজ|মাপ)/iu.test(text)) facts.push('body_size_fit');
    if (/\b(?:length|inseam|outseam|shoulder)\b.{0,40}\b(?:inch(?:es)?|cm|measure(?:ment)?|koto|how\s+long|how\s+many)\b|\b(?:inch(?:es)?|cm|measure(?:ment)?)\b.{0,40}\b(?:length|inseam|outseam|shoulder)\b/iu.test(text)) facts.push('garment_measurement');
    return facts;
};

const LIVE_TRANSACTION_STATE = /\b(?:my|the|your)\s+(?:order|parcel|shipment|invoice|consignment|refund)\b|\b(?:order|parcel|shipment|invoice|consignment|payment|refund)\s+(?:status|tracking|number|confirmation)\b|\b(?:total\s+bill|total\s+amount|grand\s+total|bill\s+amount|bill|transaction|consignment|tracking number|invoice number|transaction id|paid|payment (?:received|confirmed|verified|successful)|refund (?:status|request)|cancel(?:led|ed)?\s+(?:my|the\s+)?order|(?:place|confirm|track)\s+(?:my|the\s+)?(?:order|parcel|shipment)|parcel\s+(?:tracking|status)|courier\s+(?:tracking|status))\b|\border\s+(?:is\s+)?(?:confirmed|confirm(?:ed)?|hoise|hoyeche)\b|অর্ডার\s*(?:স্ট্যাটাস|কনফার্ম|নম্বর|হয়েছে|হয়েছে)|পার্সেল\s*(?:স্ট্যাটাস|ট্র্যাকিং)|মোট\s*(?:বিল|টাকা|পরিমাণ)|কনসাইনমেন্ট|ট্র্যাকিং|চালান/i;
const ORDER_TOTAL_REQUEST = /\b(?:(?:total|grand)\s+(?:bill|amount|price)|bill\s+total|total\s+invoice|invoice\s+total)\b|\b(?:bill|invoice)\s+(?:total|amount)\b|মোট\s*(?:বিল|টাকা|পরিমাণ)/iu;

const classifyMessageIntent = (record) => {
    const message = String(record.customerMessage || record.message || '').toLocaleLowerCase();
    const inputType = normalizeInputType(record.inputType);
    const transactionRequested = LIVE_TRANSACTION_STATE.test(message);
    const priceNegotiation = PRICE_NEGOTIATION.test(message);
    const deliveryTiming = (/\b(?:parcel|courier|shipping|delivery)\b|পার্সেল|কুরিয়ার|কুরিয়ার|ডেলিভারি/iu.test(message)
        && /\b(?:how long|how many days|days?|time|take|takes|koto din|kotodin|din lage|din lagbe|j কতদিন)\b|কত\s*দিন|কয়\s*দিন|কতদিন|দিন\s*লাগে|দিন\s*লাগবে/iu.test(message));
    const policyRequested = priceNegotiation || deliveryTiming
        || /\b(delivery|shipping|delivery charge|delivery fee|return|exchange|cash on delivery|\bcod\b|refund(?: policy)?|payment(?: method| options)?|pay by|advance payment|prepayment|courier|same day|arrive together|arrive separately|together or separately|separate delivery|single shipment|parcel)\b|ডেলিভারি|কুরিয়ার|কুরিয়ার|পার্সেল|রিটার্ন|এক্সচেঞ্জ|চার্জ|পেমেন্ট|অগ্রিম|একসাথে|আলাদা করে/iu.test(message);
    const policyFeeOnly = policyRequested
        && !/\b(price|cost|dam|daam|current price)\b|দাম/iu.test(message);
    const facts = requestedFacts(message).filter(field => !(field === 'price' && (priceNegotiation || policyFeeOnly || ORDER_TOTAL_REQUEST.test(message)))
        && !(field === 'stock' && transactionRequested));
    const productCue = /\b(product|item|dress|t[\s-]?shirt|tee|shirt|panjabi|jacket|pant|trouser|legging|kameez|kamiz|cargo|denim|kurti|saree)\b|পণ্য|জামা|কামিজ|পাঞ্জাবি|ট্রাউজার|লেগিংস/i.test(message);
    const imageInput = ['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(inputType);
    const imageMentioned = /\b(photo|image|picture|looks like|embroid|print|pattern|visible|design)\b|ছবি|নকশা/i.test(message);
    const tags = [];
    const domains = [];
    if (transactionRequested) {
        tags.push('transaction_or_live_state');
        domains.push('live_transaction_state');
    }
    if (policyRequested) {
        tags.push('merchant_policy');
        domains.push('merchant_policy');
    }
    if (imageInput && !message.trim()) {
        tags.push('image_evidence_required');
        domains.push('product_media');
    } else if (imageMentioned) {
        tags.push('image_or_catalog_evidence_required');
        domains.push('product_media');
    }
    if (facts.length) {
        tags.push('product_fact_request');
        domains.push(...facts.map(field => ({
            price: 'product_price', stock: 'product_stock', material: 'product_attribute',
            color: 'product_variant', variant: 'product_variant',
        })[field] || 'product_attribute'));
    } else if (productCue && !policyRequested && !transactionRequested) {
        tags.push('product_identity_request');
        domains.push('product_identification');
    }
    if (!tags.length) {
        tags.push('intent_unresolved');
        domains.push('unknown_or_unsupported');
    }
    const uniqueDomains = [...new Set(domains)];
    const hasProductDomain = uniqueDomains.some(domain => domain.startsWith('product_') || domain === 'product_identification');
    const authority = hasProductDomain && uniqueDomains.length > 1 ? 'composite_authority'
        : transactionRequested ? 'live_transaction_state'
            : uniqueDomains[0] === 'merchant_policy' ? 'approved_merchant_policy'
                : uniqueDomains[0] === 'live_transaction_state' ? 'live_transaction_state'
                : uniqueDomains[0] === 'product_media' ? 'authorized_raster_image'
                    : uniqueDomains[0]?.startsWith('product_') || uniqueDomains[0] === 'product_identification'
                        ? 'merchant_catalog_snapshot' : 'not_established';
    return { tags, domains: uniqueDomains, authority };
};

const containsPhrase = (message, phrase) => {
    const normalizedMessage = String(message || '').normalize('NFKC').toLocaleLowerCase();
    const normalizedPhrase = String(phrase || '').normalize('NFKC').toLocaleLowerCase().trim();
    if (!normalizedPhrase) return false;
    const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{M}\\p{N}])`, 'iu').test(normalizedMessage);
};

const productAliases = (product) => [...new Set([
    product.name,
    product.name_bn,
    ...(Array.isArray(product.aliases) ? product.aliases : []),
])].filter(Boolean);

const catalogProductCategory = product => {
    const value = `${product?.id || ''} ${product?.name || ''} ${product?.category || ''}`.toLocaleLowerCase();
    if (/\b(?:panjabi|punjabi)\b|পাঞ্জাবি/.test(value)) return 'panjabi';
    if (/\b(?:cargo|pant|pants|trouser|trousers|legging|leggings)\b|প্যান্ট|ট্রাউজার/.test(value)) return 'lower_clothing';
    if (/\b(?:kamiz|kamij|kameez|kurti|saree|dress)\b|কামিজ|শাড়ি|শাড়ি/.test(value)) return 'women_clothing';
    if (/\b(?:denim|jacket)\b|জ্যাকেট/.test(value)) return 'outerwear';
    return null;
};

const explicitProductCategories = message => {
    const text = String(message || '').normalize('NFKC').toLocaleLowerCase();
    const categories = [];
    if (/\b(?:t[\s-]?shirts?|tees?)\b/.test(text)) categories.push('upper_clothing');
    if (/\b(?:panjabi|punjabi)\b|পাঞ্জাবি/.test(text)) categories.push('panjabi');
    if (/\b(?:cargo|pant|pants|trouser|trousers|legging|leggings)\b|প্যান্ট|ট্রাউজার|লেগিংস/.test(text)) categories.push('lower_clothing');
    if (/\b(?:kamiz|kamij|kameez|kurti|saree|dress)\b|কামিজ|শাড়ি|শাড়ি/.test(text)) categories.push('women_clothing');
    if (/\b(?:denim|jacket)\b|জ্যাকেট/.test(text)) categories.push('outerwear');
    return [...new Set(categories)];
};

const resolveFixtureProduct = (message, tenantId, catalog, previousProductId) => {
    const scoped = catalog.filter(product => product.shop_id === tenantId && product.is_active !== false);
    const matches = scoped.filter(product => productAliases(product).some(alias => containsPhrase(message, alias)));
    if (matches.length === 1) return { product: matches[0], ambiguous: false };
    if (matches.length > 1) return { product: null, ambiguous: true };
    if (previousProductId) {
        const previous = scoped.find(product => String(product.id) === String(previousProductId));
        const hasExplicitProductCue = /\b(product|item|dress|shirt|panjabi|jacket|pant|trouser|kameez|kamiz|cargo|denim|kurti|saree)\b|পণ্য|জামা|কামিজ|পাঞ্জাবি/i.test(message);
        const categories = explicitProductCategories(message);
        const sameCatalogCategory = previous && categories.length === 1
            && categories[0] === catalogProductCategory(previous);
        const contextualFactCue = requestedFacts(message).length > 0
            || unsupportedRequestedFacts(message).length > 0;
        const categoryCompatible = categories.length === 0 || sameCatalogCategory;
        if (previous && categoryCompatible && (/\b(it|this|that|same|previous|earlier|etar|otar|tar|eita)\b|এটা|সেটা|ওইটা|আগেরটা/i.test(message)
            || (contextualFactCue && (!hasExplicitProductCue || sameCatalogCategory)))) {
            return { product: previous, ambiguous: false };
        }
    }
    return { product: null, ambiguous: false };
};

// The expected-answer context is advanced only from source-customer turns.
// Candidate replies and retrieved products are deliberately not accepted here.
const createOracleContextTracker = (tenantId, catalog) => {
    let productId = null;
    return Object.freeze({
        currentProductId: () => productId,
        observeSourceTurn: record => {
            const message = String(record.customerMessage || record.message || '');
            const classification = classifyMessageIntent(record);
            const previous = catalog.find(product => String(product.id) === String(productId));
            const categories = explicitProductCategories(message);
            const imageBearing = ['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(normalizeInputType(record.inputType));
            const productCategorySwitch = Boolean(previous && categories.length
                && (categories.length !== 1 || categories[0] !== catalogProductCategory(previous)));
            // An attachment may show a different product. Attachment metadata
            // and unavailable pixels are not evidence of the earlier product.
            const resolved = resolveFixtureProduct(message, tenantId, catalog, imageBearing ? null : productId);
            if (resolved.product) {
                productId = String(resolved.product.id);
            } else if (imageBearing || resolved.ambiguous || productCategorySwitch || classification.tags.includes('product_fact_request')
                || classification.tags.includes('product_identity_request')) {
                productId = null;
            }
            return productId;
        },
    });
};

const authoritativeNumber = (value, integer = false) => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && (!integer || Number.isInteger(number)) ? number : null;
};

const authoritativeText = value => typeof value === 'string' && value.trim() ? value.trim() : null;

const variantOptions = (variant) => {
    const name = String(variant.option_name || '').toLowerCase();
    return {
        size: authoritativeText(variant.size) || (name === 'size' ? authoritativeText(variant.option_value) : null),
        color: authoritativeText(variant.color) || (/^colou?r$/.test(name) ? authoritativeText(variant.option_value) : null),
    };
};

const resolveOracleVariant = (message, variants) => {
    const requested = { size: new Set(), color: new Set() };
    const normalizeDigits = value => value.normalize('NFKC').toLocaleLowerCase()
        .replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
    const normalize = value => normalizeDigits(value).replace(/\bw\s*(\d{2})\b/gi, '$1');
    const normalizedMessage = normalizeDigits(String(message));
    // A recognizable but unlisted size must not silently fall back to the
    // parent's price/stock. Unknown combinations require merchant evidence.
    for (const match of normalizedMessage.matchAll(/\b(?:size\s+(\d{1,3}|x{0,4}[sl]|m)|((?:x{0,4}[sl]|m|\d{1,3}))\s+size)\b/gi)) {
        requested.size.add(normalize(match[1] || match[2]));
    }
    for (const match of normalizedMessage.matchAll(/\bw\s*(\d{2})\b/gi)) requested.size.add(normalize(match[1]));
    for (const match of String(message).matchAll(/(?:সাইজ|মাপ)\s*([০-৯]{1,3})/giu)) requested.size.add(normalize(match[1]));
    for (const match of normalizedMessage.matchAll(/(\d{1,3})\s*সাইজ(?:ের|র|ে)?/giu)) requested.size.add(normalize(match[1]));
    const hasColorCue = /\bcolou?r\b|\bshade\b|রং|রঙ/i.test(message);
    if (hasColorCue) {
        for (const variant of variants) {
            const color = variantOptions(variant).color;
            if (color && containsPhrase(message, color)) requested.color.add(normalize(color));
        }
    }
    for (const match of String(message).matchAll(/\bcolou?r\s+([\p{L}]+)/giu)) {
        const value = normalize(match[1]);
        if (!['is', 'of', 'and', 'or', 'does', 'do', 'are', 'available', 'options'].includes(value)
            && ![...requested.color].some(known => known === value || known.startsWith(`${value} `))) {
            requested.color.add(value);
        }
    }
    if (!requested.size.size && !requested.color.size) return { variant: null, status: 'NOT_REQUESTED' };
    const matches = variants.filter(variant => {
        if (variant.is_active === false) return false;
        const options = variantOptions(variant);
        return Object.entries(requested).every(([dimension, values]) => !values.size
            || (values.size === 1 && options[dimension] && values.has(normalize(options[dimension]))));
    });
    return {
        variant: matches.length === 1 ? matches[0] : null,
        status: matches.length === 1 ? 'RESOLVED' : (matches.length ? 'AMBIGUOUS' : 'NOT_FOUND'),
    };
};

const classifyOracleTurn = (record, tenantId, catalog, previousProductId = null) => {
    const message = String(record.customerMessage || record.message || '');
    const inputType = normalizeInputType(record.inputType);
    const imageInput = ['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(inputType);
    const classification = classifyMessageIntent(record);
    const tags = classification.tags;
    const productRequest = tags.includes('product_fact_request') || tags.includes('product_identity_request');
    const authorityHandoffDomains = classification.domains.filter(domain => ['merchant_policy', 'live_transaction_state'].includes(domain));
    const crossDomainHandoffs = productRequest ? authorityHandoffDomains : [];
    const withInputProvenance = result => ({
        ...result,
        inputType,
        textOnlyMetricEligible: inputType === 'TEXT',
        ...(imageInput ? { imageAuthority: result.imageAuthority || 'NO_REAL_IMAGE_EVALUATED' } : {}),
    });
    if (tags.includes('transaction_or_live_state') && !productRequest) {
        return withInputProvenance({
            domain: 'outside_product', domains: classification.domains, requiredAuthority: classification.authority,
            eligibility: 'NOT_ANSWERABLE', eligibleSlots: [], classificationTags: tags,
            crossDomainHandoffs,
        });
    }
    if (tags.includes('merchant_policy') && !productRequest) {
        return withInputProvenance({
            domain: 'merchant_policy', domains: classification.domains, requiredAuthority: classification.authority,
            eligibility: 'NOT_ANSWERABLE', eligibleSlots: [], classificationTags: tags,
            crossDomainHandoffs,
        });
    }
    if (imageInput && !message.trim()) {
        return withInputProvenance({
            domain: 'image_dependent', requiredAuthority: 'authorized_raster_image_and_vision_provider',
            domains: classification.domains,
            eligibility: 'NOT_ANSWERABLE', productId: null,
            eligibleSlots: [], classificationTags: tags, imageAuthority: 'NO_REAL_IMAGE_EVALUATED', crossDomainHandoffs,
        });
    }
    const resolved = resolveFixtureProduct(message, tenantId, catalog, previousProductId);
    if (!resolved.product) {
        return withInputProvenance({
            domain: resolved.ambiguous ? 'ambiguous_product' : 'product_identity_unresolved',
            domains: classification.domains,
            requiredAuthority: classification.authority,
            eligibility: 'NOT_ANSWERABLE', productId: null, eligibleSlots: [], classificationTags: tags,
            crossDomainHandoffs,
        });
    }

    const product = resolved.product;
    const requested = requestedFacts(message);
    const unknownRequestedFields = unsupportedRequestedFacts(message);
    const allVariants = Array.isArray(product.variants) ? product.variants : [];
    const variants = allVariants.filter(variant => variant.is_active !== false);
    const selection = (requested.length === 0 && unknownRequestedFields.some(field => ['garment_measurement', 'body_size_fit'].includes(field)))
        ? { variant: null, status: 'NOT_REQUESTED' }
        : resolveOracleVariant(message, allVariants);
    const selectedVariant = selection.variant;
    const slots = [];
    if (['AMBIGUOUS', 'NOT_FOUND'].includes(selection.status)) {
        return withInputProvenance({
            domain: 'unknown_product_attribute', requiredAuthority: classification.authority,
            domains: classification.domains,
            eligibility: 'NOT_ANSWERABLE', productId: String(product.id), selectedVariantId: null,
            variantResolution: selection.status, eligibleSlots: [],
            unknownRequestedFields: [...new Set([...unknownRequestedFields, ...requested])], classificationTags: tags,
            crossDomainHandoffs,
        });
    }
    if (requested.includes('price')) {
        const parentPrice = authoritativeNumber(product.price);
        const currency = selectedVariant?.currency ?? product.currency ?? 'BDT';
        const variantPrice = variant => variant.price == null ? parentPrice : authoritativeNumber(variant.price);
        const genericPriceSafe = parentPrice !== null && variants.length > 0 && variants.every(variant =>
            variantPrice(variant) === parentPrice && (variant.currency ?? product.currency ?? 'BDT') === 'BDT');
        const amount = selectedVariant ? variantPrice(selectedVariant)
            : (allVariants.length ? (genericPriceSafe ? parentPrice : null) : parentPrice);
        if (amount !== null && currency === 'BDT') {
            slots.push({ field: 'price', expectedValue: amount, currency: 'BDT', evidenceId: `${product.id}:${selectedVariant?.id || 'price'}` });
        } else unknownRequestedFields.push('price');
    }
    if (requested.includes('stock')) {
        const quantity = authoritativeNumber(selectedVariant ? selectedVariant.quantity : product.quantity, true);
        const trackQuantity = selectedVariant ? true : product.track_quantity;
        const stock = trackQuantity === true
            ? (quantity !== null ? (quantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK') : null)
            : (trackQuantity === false && !selectedVariant && typeof product.in_stock === 'boolean' ? (product.in_stock ? 'IN_STOCK' : 'OUT_OF_STOCK') : null);
        if (stock) slots.push({ field: selectedVariant ? 'variant_stock' : 'stock', expectedValue: stock, evidenceId: `${product.id}:${selectedVariant?.id || 'stock'}` });
        else unknownRequestedFields.push('stock');
    }
    if (requested.includes('material')) {
        // `ai_material` is image-analysis/retrieval metadata in production and
        // remains UNCERTAIN. A fixture label named verifiedMaterial is not an
        // independent merchant approval or a runtime-visible fact.
        const material = product.materialAuthority === 'merchant_approved'
            ? authoritativeText(product.merchantApprovedMaterial) : null;
        if (material) slots.push({ field: 'material', expectedValue: material, evidenceId: `${product.id}:material` });
        else unknownRequestedFields.push('material');
    }
    if (requested.includes('color')) {
        const color = selectedVariant && variantOptions(selectedVariant).color;
        if (color) slots.push({ field: 'color', expectedValue: color, evidenceId: `${product.id}:${selectedVariant?.id || 'color'}` });
        else unknownRequestedFields.push('color');
    }
    if (requested.includes('variant')) {
        const value = selectedVariant && (authoritativeText(selectedVariant.option_value) || variantOptions(selectedVariant).size);
        if (value) slots.push({ field: 'variant', expectedValue: value, evidenceId: `${product.id}:${selectedVariant.id}` });
        else unknownRequestedFields.push('variant');
    }
    if (!requested.length && !unknownRequestedFields.length) slots.push({ field: 'identity', expectedValue: product.name, evidenceId: `${product.id}:identity` });
    return withInputProvenance({
        domain: crossDomainHandoffs.length ? 'multi_domain'
            : !slots.length && unknownRequestedFields.length ? 'unknown_product_attribute' : 'product',
        domains: classification.domains,
        requiredAuthority: classification.authority,
        eligibility: slots.length ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
        productId: String(product.id),
        selectedVariantId: selectedVariant ? String(selectedVariant.id) : null,
        variantResolution: selection.status,
        eligibleSlots: slots,
        unknownRequestedFields,
        classificationTags: tags,
        crossDomainHandoffs,
    });
};

const buildDatasetIndex = (source) => {
    const input = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const { records } = parseCsv(input.toString('utf8'));
    const dataset = validateDataset(records);
    const personaOrder = [...new Set(records.map(record => String(record.personaId).trim()))];
    const personaIds = new Map(personaOrder.map((id, index) => [id, `P${String(index + 1).padStart(2, '0')}`]));
    const scenarioOrdinalByPersona = new Map();
    const scenarios = records.map(record => {
        const sourcePersonaId = String(record.personaId).trim();
        const personaId = personaIds.get(sourcePersonaId);
        const turn = Number.parseInt(record.turn, 10);
        const inputType = normalizeInputType(record.inputType);
        const language = normalizeLanguage(record.language);
        const prior = scenarioOrdinalByPersona.get(sourcePersonaId) || null;
        scenarioOrdinalByPersona.set(sourcePersonaId, turn);
        return {
            scenarioId: `scenario-${personaId.slice(1)}-${String(turn).padStart(2, '0')}`,
            personaId,
            turn,
            inputType,
            language,
            classificationTags: classifyMessageIntent(record).tags,
            sourceInputPresent: Boolean(String(record.customerMessage || '').trim()),
            attachmentCount: String(record.simulatedAttachment || '').match(/\bimage\s*#?\s*\d+\b/gi)?.length || 0,
            _sourcePersonaKey: sourcePersonaId,
            _sourceRecord: record,
            _priorTurn: prior,
        };
    });
    const personas = personaOrder.map(sourceId => ({
        id: personaIds.get(sourceId),
        turnCount: scenarios.filter(scenario => scenario._sourcePersonaKey === sourceId).length,
    }));
    const counts = { inputTypes: {}, languages: {} };
    for (const scenario of scenarios) {
        counts.inputTypes[scenario.inputType] = (counts.inputTypes[scenario.inputType] || 0) + 1;
        counts.languages[scenario.language] = (counts.languages[scenario.language] || 0) + 1;
    }
    const sourceSha256 = crypto.createHash('sha256').update(input).digest('hex');
    const safeScenarios = scenarios.map(({ _sourcePersonaKey, _sourceRecord, _priorTurn, ...safe }) => safe);
    const publicIndex = {
        source: { sha256: sourceSha256, personaCount: dataset.personaCount, scenarioCount: dataset.scenarioCount },
        personas,
        counts,
        scenarios: safeScenarios,
    };
    Object.defineProperties(publicIndex, {
        records: { value: records, enumerable: false },
        internalScenarios: { value: scenarios, enumerable: false },
    });
    return publicIndex;
};

module.exports = {
    TENANTS,
    IMAGE_FIXTURE_IDS,
    validateRunRequest,
    validatePlaygroundRequest,
    buildDatasetIndex,
    classifyOracleTurn,
    classifyMessageIntent,
    resolveFixtureProduct,
    createOracleContextTracker,
};
