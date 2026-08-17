'use strict';

/**
 * Controlled, non-production semantic evaluation corpus.
 *
 * This module deliberately contains no database, Qdrant, deployment, or
 * provider-client imports. The corpus is separate from the mutable PostgreSQL
 * source sample used by the migration proof so semantic calibration has stable
 * ground truth and meaningful ranking competition.
 */

const POSITIVE_THRESHOLD = 0.25;
const NEGATIVE_THRESHOLD = 0.5;
const CALIBRATION_DIMENSIONS = 384;
const DIAGNOSTIC_DIMENSIONS = 768;
const TOKEN_PATTERN = /[\p{L}\p{N}]{3,}/gu;

const freezeRecord = (record) => Object.freeze({
    ...record,
    authoritativeFacts: Object.freeze([...record.authoritativeFacts]),
});

const CONTROLLED_FIXTURE_DOCUMENTS = Object.freeze([
    freezeRecord({
        fixtureId: 'fixture-shop-hours',
        sourceType: 'business_info',
        title: 'Shop opening hours',
        content: 'The fictional Dhaka shop opens every day from 10:00 to 20:00 Bangladesh time. The evening service window ends at 20:00.',
        authoritativeFacts: ['The shop opens daily from 10:00 to 20:00 Bangladesh time.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-delivery-policy',
        sourceType: 'faq',
        title: 'Delivery timing by zone',
        content: 'Delivery inside Dhaka takes 1 to 2 days. Delivery outside Dhaka takes 3 to 5 days after order confirmation.',
        authoritativeFacts: ['Inside-Dhaka delivery takes 1 to 2 days; outside-Dhaka delivery takes 3 to 5 days.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-cod-payment',
        sourceType: 'faq',
        title: 'Cash on delivery and payment',
        content: 'Cash on delivery is available across Bangladesh. Customers may also pay by bKash before dispatch.',
        authoritativeFacts: ['Cash on delivery is available across Bangladesh.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-return-policy',
        sourceType: 'faq',
        title: 'Return and exchange window',
        content: 'Unused items may be exchanged or returned within 7 days of delivery when the original tags and packaging are intact.',
        authoritativeFacts: ['Unused items can be returned or exchanged within 7 days when tags and packaging are intact.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-black-panjabi',
        sourceType: 'product',
        title: 'Black cotton Panjabi',
        content: 'The black cotton Panjabi is available in sizes M, L, and XL. Its regular fit uses a straight collar.',
        authoritativeFacts: ['The black cotton Panjabi is available in sizes M, L, and XL.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-womens-kurti',
        sourceType: 'product',
        title: 'Teal cotton womens kurti',
        content: 'The teal cotton womens kurti is offered in sizes S, M, and L. It has a long tunic cut.',
        authoritativeFacts: ['The teal cotton womens kurti is available in sizes S, M, and L.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-shoe-product',
        sourceType: 'product',
        title: 'Brown leather sandals',
        content: 'The brown leather sandal is stocked in shoe sizes 40, 41, and 42. It has an adjustable strap.',
        authoritativeFacts: ['The brown leather sandal is stocked in shoe sizes 40, 41, and 42.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-order-process',
        sourceType: 'faq',
        title: 'How to place an order',
        content: 'To place an order, send the product name, size, delivery address, and phone number through the shop inbox. The team confirms availability before dispatch.',
        authoritativeFacts: ['An order requires the product name, size, delivery address, and phone number in the shop inbox.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-panjabi-stock',
        sourceType: 'product',
        title: 'Black Panjabi stock status',
        content: 'The black cotton Panjabi currently has two units in size L and one unit in size XL. Stock changes after confirmed orders.',
        authoritativeFacts: ['Current stock is two units in size L and one unit in size XL for the black cotton Panjabi.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-courier-tracking',
        sourceType: 'faq',
        title: 'Courier pickup and tracking',
        content: 'Courier pickup is scheduled every afternoon after order confirmation. Customers receive a tracking code when the parcel leaves the shop.',
        authoritativeFacts: ['A tracking code is sent when the parcel leaves the shop.'],
    }),
]);

const CONTROLLED_POSITIVE_QUERIES = Object.freeze([
    Object.freeze({
        queryId: 'bn-shop-hours',
        languageClass: 'bengali',
        query: 'দোকান কখন খোলা থাকে?',
        expectedSourceId: 'fixture-shop-hours',
        expectedFact: 'daily opening hours are 10:00 to 20:00 Bangladesh time',
    }),
    Object.freeze({
        queryId: 'bn-dhaka-delivery',
        languageClass: 'bengali',
        query: 'ঢাকার ভেতরে ডেলিভারি কত দিনে হবে?',
        expectedSourceId: 'fixture-delivery-policy',
        expectedFact: 'inside-Dhaka delivery takes 1 to 2 days',
    }),
    Object.freeze({
        queryId: 'bn-panjabi-size',
        languageClass: 'bengali',
        query: 'কালো পাঞ্জাবির কী কী সাইজ আছে?',
        expectedSourceId: 'fixture-black-panjabi',
        expectedFact: 'black cotton Panjabi sizes are M, L, and XL',
    }),
    Object.freeze({
        queryId: 'en-outside-dhaka-delivery',
        languageClass: 'english',
        query: 'How long does delivery outside Dhaka take?',
        expectedSourceId: 'fixture-delivery-policy',
        expectedFact: 'outside-Dhaka delivery takes 3 to 5 days',
    }),
    Object.freeze({
        queryId: 'en-opening-hours',
        languageClass: 'english',
        query: "What are the shop's opening hours?",
        expectedSourceId: 'fixture-shop-hours',
        expectedFact: 'daily opening hours are 10:00 to 20:00 Bangladesh time',
    }),
    Object.freeze({
        queryId: 'en-shoe-sizes',
        languageClass: 'english',
        query: 'Which shoe sizes are stocked for the brown sandals?',
        expectedSourceId: 'fixture-shoe-product',
        expectedFact: 'brown leather sandal sizes are 40, 41, and 42',
    }),
    Object.freeze({
        queryId: 'en-return-window',
        languageClass: 'english',
        query: 'How many days are allowed for an exchange?',
        expectedSourceId: 'fixture-return-policy',
        expectedFact: 'returns and exchanges are allowed within 7 days',
    }),
    Object.freeze({
        queryId: 'mixed-outside-dhaka-delivery',
        languageClass: 'cross_lingual',
        query: 'ঢাকার বাইরে delivery time কত?',
        expectedSourceId: 'fixture-delivery-policy',
        expectedFact: 'outside-Dhaka delivery takes 3 to 5 days',
    }),
    Object.freeze({
        queryId: 'mixed-black-panjabi-size',
        languageClass: 'cross_lingual',
        query: 'black Panjabi এর available size কী?',
        expectedSourceId: 'fixture-black-panjabi',
        expectedFact: 'black cotton Panjabi sizes are M, L, and XL',
    }),
    Object.freeze({
        queryId: 'mixed-return-window',
        languageClass: 'cross_lingual',
        query: 'return policy কত দিনের?',
        expectedSourceId: 'fixture-return-policy',
        expectedFact: 'returns and exchanges are allowed within 7 days',
    }),
]);

const CONTROLLED_NEGATIVE_QUERIES = Object.freeze([
    Object.freeze({ negativeQueryId: 'negative-astrophysics', query: 'stellar nucleosynthesis exoplanet transit' }),
    Object.freeze({ negativeQueryId: 'negative-marine-biology', query: 'coral reef plankton cetacean' }),
    Object.freeze({ negativeQueryId: 'negative-medieval-architecture', query: 'Gothic cathedral flying buttress' }),
    Object.freeze({ negativeQueryId: 'negative-quantum-computing', query: 'quantum entanglement qubit decoherence' }),
    Object.freeze({ negativeQueryId: 'negative-classical-music', query: 'counterpoint fugue sonata' }),
    Object.freeze({ negativeQueryId: 'negative-geology', query: 'igneous basalt stratigraphy' }),
    Object.freeze({ negativeQueryId: 'negative-aviation', query: 'aerodynamics turbine avionics' }),
    Object.freeze({ negativeQueryId: 'negative-paleontology', query: 'trilobite fossil paleontology' }),
    Object.freeze({ negativeQueryId: 'negative-botany', query: 'chlorophyll mycelium herbarium' }),
    Object.freeze({ negativeQueryId: 'negative-volcanology', query: 'volcanology magma tectonics' }),
]);

function normalizedTokens(value) {
    return String(value || '').toLowerCase().match(TOKEN_PATTERN) || [];
}

function lexicalOverlapTokens(query, sourceText) {
    const sourceTokens = new Set(normalizedTokens(sourceText));
    return [...new Set(normalizedTokens(query).filter((token) => sourceTokens.has(token)))];
}

function fixtureSearchText(document) {
    return `${document.title} ${document.content}`;
}

function containsPotentialPii(value) {
    const text = String(value || '');
    return /(?:^|\s)[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?:$|\s)/u.test(text)
        || /https?:\/\//iu.test(text)
        || /(?:^|\s)\+?8801\d{9}(?:$|\s)/u.test(text);
}

function validateCalibrationFixtures({
    documents = CONTROLLED_FIXTURE_DOCUMENTS,
    positiveQueries = CONTROLLED_POSITIVE_QUERIES,
    negativeQueries = CONTROLLED_NEGATIVE_QUERIES,
} = {}) {
    if (documents.length < 8) throw new Error('semantic fixture validation failed: at least 8 documents are required');

    const documentIds = new Set();
    for (const document of documents) {
        if (!document.fixtureId || documentIds.has(document.fixtureId)) {
            throw new Error(`semantic fixture validation failed: duplicate or missing fixture id ${document.fixtureId || 'missing'}`);
        }
        documentIds.add(document.fixtureId);
        if (!document.sourceType || !document.title || !document.content || !document.authoritativeFacts?.length) {
            throw new Error(`semantic fixture validation failed: incomplete document ${document.fixtureId}`);
        }
        if (containsPotentialPii(`${document.title} ${document.content}`)) {
            throw new Error(`semantic fixture validation failed: possible PII in document ${document.fixtureId}`);
        }
    }

    const queryIds = new Set();
    for (const positive of positiveQueries) {
        if (!positive.queryId || queryIds.has(positive.queryId)) {
            throw new Error(`semantic fixture validation failed: duplicate or missing query id ${positive.queryId || 'missing'}`);
        }
        queryIds.add(positive.queryId);
        if (!positive.query || !positive.languageClass || !positive.expectedSourceId || !positive.expectedFact) {
            throw new Error(`semantic fixture validation failed: incomplete positive query ${positive.queryId}`);
        }
        if (containsPotentialPii(positive.query)) {
            throw new Error(`semantic fixture validation failed: possible PII in positive query ${positive.queryId}`);
        }
        if (!documentIds.has(positive.expectedSourceId)) {
            throw new Error(`semantic fixture validation failed: expected source missing for ${positive.queryId}`);
        }
    }

    const negativeIds = new Set();
    for (const negative of negativeQueries) {
        if (!negative.negativeQueryId || negativeIds.has(negative.negativeQueryId)) {
            throw new Error(`semantic fixture validation failed: duplicate or missing negative id ${negative.negativeQueryId || 'missing'}`);
        }
        negativeIds.add(negative.negativeQueryId);
        if (!negative.query) {
            throw new Error(`semantic fixture validation failed: empty negative query ${negative.negativeQueryId}`);
        }
        if (containsPotentialPii(negative.query)) {
            throw new Error(`semantic fixture validation failed: possible PII in negative query ${negative.negativeQueryId}`);
        }
        for (const document of documents) {
            const overlaps = lexicalOverlapTokens(negative.query, fixtureSearchText(document));
            if (overlaps.length) {
                throw new Error(
                    `semantic fixture validation failed: ${negative.negativeQueryId} overlaps ${document.fixtureId}: ${overlaps.join(', ')}`,
                );
            }
        }
    }

    return true;
}

module.exports = {
    POSITIVE_THRESHOLD,
    NEGATIVE_THRESHOLD,
    CALIBRATION_DIMENSIONS,
    DIAGNOSTIC_DIMENSIONS,
    CONTROLLED_FIXTURE_DOCUMENTS,
    CONTROLLED_POSITIVE_QUERIES,
    CONTROLLED_NEGATIVE_QUERIES,
    normalizedTokens,
    lexicalOverlapTokens,
    fixtureSearchText,
    validateCalibrationFixtures,
};
