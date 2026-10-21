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
    const surfaceFinish = /\b(?:finish|shiny|matte|glossy|sheen|texture)\b|চকচকে|ম্যাট\s*ফিনিশ/iu.test(text);
    const facts = [];
    if (/\b(price|cost|how much|dam|daam|koto|current price)\b|দাম|কত/i.test(text)) facts.push('price');
    if (!bodySizeFit && /\b(stock|available|availability|in stock|out of stock|quantity)\b|স্টক|পাওয়া যাবে|আছে/i.test(text)) facts.push('stock');
    if (!surfaceFinish && /\b(material|fabric|cotton|silk|linen)\b|কাপড়|উপাদান/i.test(text)) facts.push('material');
    if (/\b(color|colour|shade)\b|রং/i.test(text)) facts.push('color');
    if (!bodySizeFit && (/\b(size|sizes|variant|option)\b|সাইজ/i.test(text) || /\bw\s?\d{2}\b/i.test(asciiText))) facts.push('variant');
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
    return facts;
};

const LIVE_TRANSACTION_STATE = /\b(?:my|the|your)\s+(?:order|parcel|shipment|invoice|consignment|refund)\b|\b(?:order|parcel|shipment|invoice|consignment|payment|refund)\s+(?:status|tracking|number|confirmation)\b|\b(?:transaction|consignment|tracking number|invoice number|transaction id|paid|payment (?:received|confirmed|verified|successful)|refund (?:status|request)|cancel(?:led|ed)?\s+(?:my|the\s+)?order|(?:place|confirm|track)\s+(?:my|the\s+)?(?:order|parcel|shipment)|parcel\s+(?:tracking|status)|courier\s+(?:tracking|status))\b|অর্ডার\s*(?:স্ট্যাটাস|কনফার্ম|নম্বর)|পার্সেল\s*(?:স্ট্যাটাস|ট্র্যাকিং)|কনসাইনমেন্ট|ট্র্যাকিং|চালান/i;

const classifyMessageIntent = (record) => {
    const message = String(record.customerMessage || record.message || '').toLocaleLowerCase();
    const inputType = normalizeInputType(record.inputType);
    if (LIVE_TRANSACTION_STATE.test(message)) {
        return { tags: ['transaction_or_live_state'], authority: 'live_transaction_state' };
    }
    if (/\b(?:discount|offer|combo|deal|coupon|promotion|negotiable|fixed price|bargain|price negotiation)\b|\b(?:discount|offer)\s+(?:dibেন|diben)\b|দাম\s*কম|ডিসকাউন্ট|ছাড়|ছাড়|অফার|ফিক্সড\s*দাম|দাম\s*নেগোশিয়েবল/iu.test(message)
        || (/\b(?:parcel|courier|shipping|delivery)\b|পার্সেল|কুরিয়ার|কুরিয়ার|ডেলিভারি/iu.test(message)
            && /\b(?:how long|how many days|days?|time|take|takes|koto din|kotodin|din lage|din lagbe|j কতদিন)\b|কত\s*দিন|কয়\s*দিন|কতদিন|দিন\s*লাগে|দিন\s*লাগবে/iu.test(message))) {
        return { tags: ['merchant_policy'], authority: 'approved_merchant_policy' };
    }
    if (/\b(delivery|shipping|delivery charge|delivery fee|return|exchange|cash on delivery|\bcod\b|refund(?: policy)?|payment(?: method| options)?|pay by|advance payment|prepayment|courier|same day|arrive together|arrive separately|together or separately|separate delivery|single shipment|parcel)\b|ডেলিভারি|কুরিয়ার|কুরিয়ার|পার্সেল|রিটার্ন|এক্সচেঞ্জ|চার্জ|পেমেন্ট|অগ্রিম|একসাথে|আলাদা করে/i.test(message)) {
        return { tags: ['merchant_policy'], authority: 'approved_merchant_policy' };
    }
    if (['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(inputType) && !String(record.customerMessage || record.message || '').trim()) {
        return { tags: ['image_evidence_required'], authority: 'authorized_raster_image' };
    }
    if (/\b(photo|image|picture|looks like|embroid|print|pattern|visible|design)\b|ছবি|নকশা/i.test(message)) {
        return { tags: ['image_or_catalog_evidence_required'], authority: 'catalog_and_authorized_image' };
    }
    if (requestedFacts(message).length) return { tags: ['product_fact_request'], authority: 'merchant_catalog_snapshot' };
    if (/\b(product|item|dress|shirt|panjabi|jacket|pant|kameez|kamiz|cargo|denim)\b|পণ্য|জামা|কামিজ|পাঞ্জাবি/i.test(message)) {
        return { tags: ['product_identity_request'], authority: 'merchant_catalog_snapshot' };
    }
    return { tags: ['intent_unresolved'], authority: 'not_established' };
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

const resolveFixtureProduct = (message, tenantId, catalog, previousProductId) => {
    const scoped = catalog.filter(product => product.shop_id === tenantId && product.is_active !== false);
    const matches = scoped.filter(product => productAliases(product).some(alias => containsPhrase(message, alias)));
    if (matches.length === 1) return { product: matches[0], ambiguous: false };
    if (matches.length > 1) return { product: null, ambiguous: true };
    if (previousProductId) {
        const previous = scoped.find(product => String(product.id) === String(previousProductId));
        const hasExplicitProductCue = /\b(product|item|dress|shirt|panjabi|jacket|pant|trouser|kameez|kamiz|cargo|denim|kurti|saree)\b|পণ্য|জামা|কামিজ|পাঞ্জাবি/i.test(message);
        const contextualFactCue = requestedFacts(message).length > 0
            || unsupportedRequestedFacts(message).length > 0;
        if (previous && (/\b(it|this|that|same|previous|earlier|etar|otar|tar|eita)\b|এটা|সেটা|ওইটা|আগেরটা/i.test(message)
            || (contextualFactCue && !hasExplicitProductCue))) {
            return { product: previous, ambiguous: false };
        }
    }
    return { product: null, ambiguous: false };
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
    const classification = classifyMessageIntent(record);
    const tags = classification.tags;
    if (tags.includes('transaction_or_live_state')) {
        return { domain: 'outside_product', requiredAuthority: classification.authority, eligibility: 'NOT_ANSWERABLE', eligibleSlots: [], classificationTags: tags };
    }
    if (tags.includes('merchant_policy')) {
        return { domain: 'merchant_policy', requiredAuthority: classification.authority, eligibility: 'NOT_ANSWERABLE', eligibleSlots: [], classificationTags: tags };
    }
    const imageInput = ['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(normalizeInputType(record.inputType));
    if (imageInput) {
        return {
            domain: 'image_dependent', requiredAuthority: 'authorized_raster_image_and_vision_provider',
            eligibility: 'NOT_ANSWERABLE', productId: null,
            eligibleSlots: [], classificationTags: tags, imageAuthority: 'NO_REAL_IMAGE_EVALUATED',
        };
    }
    const resolved = resolveFixtureProduct(message, tenantId, catalog, previousProductId);
    if (!resolved.product) {
        return {
            domain: resolved.ambiguous ? 'ambiguous_product' : 'product_identity_unresolved',
            requiredAuthority: classification.authority,
            eligibility: 'NOT_ANSWERABLE', productId: null, eligibleSlots: [], classificationTags: tags,
        };
    }

    const product = resolved.product;
    const requested = requestedFacts(message);
    const unknownRequestedFields = unsupportedRequestedFacts(message);
    const allVariants = Array.isArray(product.variants) ? product.variants : [];
    const variants = allVariants.filter(variant => variant.is_active !== false);
    const selection = resolveOracleVariant(message, allVariants);
    const selectedVariant = selection.variant;
    const slots = [];
    if (['AMBIGUOUS', 'NOT_FOUND'].includes(selection.status)) {
        return {
            domain: 'unknown_product_attribute', requiredAuthority: classification.authority,
            eligibility: 'NOT_ANSWERABLE', productId: String(product.id), selectedVariantId: null,
            variantResolution: selection.status, eligibleSlots: [],
            unknownRequestedFields: [...new Set([...unknownRequestedFields, ...requested])], classificationTags: tags,
        };
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
        const material = authoritativeText(product.verifiedMaterial);
        if (material) slots.push({ field: 'material', expectedValue: material, evidenceId: `${product.id}:material` });
        else unknownRequestedFields.push('material');
    }
    if (requested.includes('color')) {
        const color = (selectedVariant && variantOptions(selectedVariant).color) || authoritativeText(product.verifiedColor);
        if (color) slots.push({ field: 'color', expectedValue: color, evidenceId: `${product.id}:${selectedVariant?.id || 'color'}` });
        else unknownRequestedFields.push('color');
    }
    if (requested.includes('variant')) {
        const value = selectedVariant && (authoritativeText(selectedVariant.option_value) || variantOptions(selectedVariant).size);
        if (value) slots.push({ field: 'variant', expectedValue: value, evidenceId: `${product.id}:${selectedVariant.id}` });
        else unknownRequestedFields.push('variant');
    }
    if (!requested.length && !unknownRequestedFields.length) slots.push({ field: 'identity', expectedValue: product.name, evidenceId: `${product.id}:identity` });
    return {
        domain: !slots.length && unknownRequestedFields.length ? 'unknown_product_attribute' : 'product',
        requiredAuthority: classification.authority,
        eligibility: slots.length ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
        productId: String(product.id),
        selectedVariantId: selectedVariant ? String(selectedVariant.id) : null,
        variantResolution: selection.status,
        eligibleSlots: slots,
        unknownRequestedFields,
        classificationTags: tags,
    };
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
};
