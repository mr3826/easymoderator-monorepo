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
    const facts = [];
    if (/\b(price|cost|how much|dam|daam|koto|current price)\b|দাম|কত/i.test(text)) facts.push('price');
    if (/\b(stock|available|availability|in stock|out of stock|quantity)\b|স্টক|পাওয়া যাবে|আছে/i.test(text)) facts.push('stock');
    if (/\b(material|fabric|cotton|silk|linen)\b|কাপড়|উপাদান/i.test(text)) facts.push('material');
    if (/\b(color|colour|shade)\b|রং/i.test(text)) facts.push('color');
    if (/\b(size|sizes|variant|option)\b|সাইজ/i.test(text)) facts.push('variant');
    return facts;
};

const classifyMessageIntent = (record) => {
    const message = String(record.customerMessage || record.message || '').toLocaleLowerCase();
    const inputType = normalizeInputType(record.inputType);
    if (/\b(order|payment|paid|transaction|courier|tracking|refund|cancel|booking|dispatch|confirmation)\b|পেমেন্ট|অর্ডার|কুরিয়ার|রিফান্ড|বাতিল/i.test(message)) {
        return { tags: ['transaction_or_live_state'], authority: 'live_transaction_state' };
    }
    if (/\b(delivery|shipping|delivery charge|delivery fee|return|exchange|cash on delivery|\bcod\b|refund policy|same day)\b|ডেলিভারি|কুরিয়ার|রিটার্ন|এক্সচেঞ্জ|চার্জ/i.test(message)) {
        return { tags: ['merchant_policy'], authority: 'approved_merchant_policy' };
    }
    if (['IMAGE', 'IMAGE_TEXT', 'IMAGE_IMAGE'].includes(inputType) && !String(record.customerMessage || record.message || '').trim()) {
        return { tags: ['image_evidence_required'], authority: 'authorized_raster_image' };
    }
    if (/\b(photo|image|picture|looks like|embroid|print|pattern|visible|color|colour|shade|design)\b|ছবি|রং|নকশা/i.test(message)) {
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
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(normalizedMessage);
};

const productAliases = (product) => [...new Set([
    product.name,
    product.name_bn,
    ...(Array.isArray(product.aliases) ? product.aliases : []),
])].filter(Boolean);

const resolveFixtureProduct = (message, tenantId, catalog, previousProductId) => {
    const scoped = catalog.filter(product => product.shop_id === tenantId);
    const matches = scoped.filter(product => productAliases(product).some(alias => containsPhrase(message, alias)));
    if (matches.length === 1) return { product: matches[0], ambiguous: false };
    if (matches.length > 1) return { product: null, ambiguous: true };
    if (previousProductId) {
        const previous = scoped.find(product => String(product.id) === String(previousProductId));
        if (previous && /\b(it|this|that|same|previous|earlier|etar|otar|tar|eita)\b|এটা|সেটা|ওইটা|আগেরটা/i.test(message)) {
            return { product: previous, ambiguous: false };
        }
    }
    return { product: null, ambiguous: false };
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
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selectedVariant = variants.find(variant => containsPhrase(message, variant.option_value)) || null;
    const slots = [];
    const unknownRequestedFields = [];
    if (requested.includes('price')) {
        const variantPrice = selectedVariant ? selectedVariant.price : null;
        const genericPriceSafe = !selectedVariant && product.price != null && variants.every(variant =>
            variant.price != null && Number(variant.price) === Number(product.price));
        const amount = selectedVariant ? variantPrice : (variants.length ? (genericPriceSafe ? product.price : null) : product.price);
        if (amount != null && Number.isFinite(Number(amount))) {
            slots.push({ field: 'price', expectedValue: Number(amount), currency: 'BDT', evidenceId: `${product.id}:${selectedVariant?.id || 'price'}` });
        }
    }
    if (requested.includes('stock')) {
        const quantity = selectedVariant ? selectedVariant.quantity : product.quantity;
        const trackQuantity = selectedVariant ? true : Boolean(product.track_quantity);
        const stock = trackQuantity && Number.isFinite(Number(quantity))
            ? (Number(quantity) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK')
            : (!selectedVariant && typeof product.in_stock === 'boolean' ? (product.in_stock ? 'IN_STOCK' : 'OUT_OF_STOCK') : null);
        if (stock) slots.push({ field: selectedVariant ? 'variant_stock' : 'stock', expectedValue: stock, evidenceId: `${product.id}:${selectedVariant?.id || 'stock'}` });
    }
    if (requested.includes('material')) {
        if (product.verifiedMaterial) slots.push({ field: 'material', expectedValue: product.verifiedMaterial, evidenceId: `${product.id}:material` });
        else unknownRequestedFields.push('material');
    }
    if (requested.includes('color')) {
        const verifiedVariantColor = selectedVariant && /color/i.test(selectedVariant.option_name || '') ? selectedVariant.option_value : null;
        if (product.verifiedColor || verifiedVariantColor) slots.push({ field: 'color', expectedValue: product.verifiedColor || verifiedVariantColor, evidenceId: `${product.id}:color` });
        else unknownRequestedFields.push('color');
    }
    if (requested.includes('variant') && selectedVariant && selectedVariant.option_value) {
        slots.push({ field: 'variant', expectedValue: selectedVariant.option_value, evidenceId: `${product.id}:${selectedVariant.id}` });
    }
    if (!requested.length) slots.push({ field: 'identity', expectedValue: product.name, evidenceId: `${product.id}:identity` });
    return {
        domain: !slots.length && unknownRequestedFields.length ? 'unknown_product_attribute' : 'product',
        requiredAuthority: classification.authority,
        eligibility: slots.length ? 'ANSWERABLE' : 'NOT_ANSWERABLE',
        productId: String(product.id),
        selectedVariantId: selectedVariant ? String(selectedVariant.id) : null,
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
