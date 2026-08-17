'use strict';

/**
 * Controlled, non-production semantic evaluation corpus.
 *
 * This module deliberately contains no database, Qdrant, deployment, or
 * provider-client imports. The corpus is separate from the mutable PostgreSQL
 * source sample used by the migration proof so semantic calibration has stable
 * ground truth and meaningful ranking competition.
 */

const crypto = require('crypto');

const POSITIVE_THRESHOLD = 0.25;
const CALIBRATION_DIMENSIONS = 384;
const DIAGNOSTIC_DIMENSIONS = 768;
const TOKEN_PATTERN = /[\p{L}\p{N}]{3,}/gu;

const freezeRecord = (record) => Object.freeze({
    ...record,
    authoritativeFacts: Object.freeze([...record.authoritativeFacts]),
});

const freezeQuery = (record) => Object.freeze({ ...record });

const CONTROLLED_FIXTURE_DOCUMENTS = Object.freeze([
    freezeRecord({
        fixtureId: 'fixture-shop-hours',
        sourceType: 'business_info',
        title: 'Shop opening hours',
        content: 'The fictional Dhaka shop opens every day from 10:00 to 20:00 Bangladesh time. The evening service window ends at 20:00.',
        authoritativeFacts: ['The shop opens daily from 10:00 to 20:00 Bangladesh time.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-shop-contact',
        sourceType: 'business_info',
        title: 'Shop contact channel',
        content: 'Customers can contact the fictional shop through its inbox. The team answers product and order questions in that inbox.',
        authoritativeFacts: ['The shop inbox is the contact channel for product and order questions.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-delivery-policy',
        sourceType: 'faq',
        title: 'Delivery timing by zone',
        content: 'Delivery inside Dhaka takes 1 to 2 days. Delivery outside Dhaka takes 3 to 5 days after order confirmation.',
        authoritativeFacts: ['Inside-Dhaka delivery takes 1 to 2 days; outside-Dhaka delivery takes 3 to 5 days.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-dhaka-pickup',
        sourceType: 'faq',
        title: 'Dhaka pickup window',
        content: 'Confirmed parcels can be collected from the fictional Dhaka pickup point on weekdays between 12:00 and 18:00.',
        authoritativeFacts: ['Confirmed parcels are available for weekday pickup from 12:00 to 18:00.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-cod-payment',
        sourceType: 'faq',
        title: 'Cash on delivery payment',
        content: 'Cash on delivery is available across Bangladesh. Customers pay the courier when the parcel arrives.',
        authoritativeFacts: ['Cash on delivery is available across Bangladesh and is paid to the courier on arrival.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-bkash-payment',
        sourceType: 'faq',
        title: 'bKash payment confirmation',
        content: 'For prepaid orders, customers send the bKash transaction reference in the shop inbox before dispatch.',
        authoritativeFacts: ['Prepaid customers send the bKash transaction reference before dispatch.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-return-policy',
        sourceType: 'faq',
        title: 'Return and exchange window',
        content: 'Unused items may be exchanged or returned within 7 days of delivery when the original tags and packaging are intact.',
        authoritativeFacts: ['Unused items can be returned or exchanged within 7 days when tags and packaging are intact.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-color-exchange',
        sourceType: 'faq',
        title: 'Colour exchange conditions',
        content: 'A colour exchange is accepted before dispatch when the requested colour is available. The customer must keep the item unused.',
        authoritativeFacts: ['Colour changes are accepted before dispatch when the item is unused and the requested colour is available.'],
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
        fixtureId: 'fixture-size-guide',
        sourceType: 'faq',
        title: 'Clothing size guide',
        content: 'Customers choose a clothing size by measuring chest width and comparing it with the garment size guide before ordering.',
        authoritativeFacts: ['The clothing size guide uses chest width measured before ordering.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-order-process',
        sourceType: 'faq',
        title: 'How to place an order',
        content: 'To place an order, send the product name, size, delivery address, and phone number through the shop inbox. The team confirms availability before dispatch.',
        authoritativeFacts: ['An order requires the product name, size, delivery address, and phone number in the shop inbox.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-order-confirmation',
        sourceType: 'faq',
        title: 'Order confirmation step',
        content: 'The shop confirms an order after checking the requested variant and delivery address. No parcel is dispatched before confirmation.',
        authoritativeFacts: ['The shop checks the variant and address before confirming or dispatching an order.'],
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
    freezeRecord({
        fixtureId: 'fixture-courier-delay',
        sourceType: 'faq',
        title: 'Courier delay notice',
        content: 'If a courier delay occurs, the shop inbox shares an updated delivery estimate after the courier reports the delay.',
        authoritativeFacts: ['A delayed parcel receives an updated estimate through the shop inbox.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-kurti-care',
        sourceType: 'product',
        title: 'Teal kurti care instructions',
        content: 'Wash the teal cotton kurti gently in cool water and dry it in shade to protect the fabric colour.',
        authoritativeFacts: ['The teal cotton kurti should be gently washed in cool water and dried in shade.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-sandal-care',
        sourceType: 'product',
        title: 'Leather sandal care',
        content: 'Keep the brown leather sandals dry and wipe them with a soft cloth after use. Do not soak the leather.',
        authoritativeFacts: ['Brown leather sandals should be kept dry and wiped with a soft cloth.'],
    }),
    freezeRecord({
        fixtureId: 'fixture-gift-wrap',
        sourceType: 'faq',
        title: 'Gift wrapping option',
        content: 'Gift wrapping can be requested in the shop inbox before dispatch. The wrapping note may include a short greeting.',
        authoritativeFacts: ['Gift wrapping and a short greeting can be requested before dispatch.'],
    }),
]);

const CONTROLLED_POSITIVE_QUERIES = Object.freeze([
    // Native Bengali cases.
    freezeQuery({ queryId: 'bn-shop-hours', languageClass: 'bengali', query: 'দোকান কখন খোলা থাকে?', expectedSourceId: 'fixture-shop-hours', expectedFact: 'daily opening hours are 10:00 to 20:00 Bangladesh time' }),
    freezeQuery({ queryId: 'bn-shop-contact', languageClass: 'bengali', query: 'দোকানের সঙ্গে কীভাবে যোগাযোগ করব?', expectedSourceId: 'fixture-shop-contact', expectedFact: 'the shop inbox is the contact channel' }),
    freezeQuery({ queryId: 'bn-dhaka-delivery', languageClass: 'bengali', query: 'ঢাকার ভেতরে ডেলিভারি কত দিনে হবে?', expectedSourceId: 'fixture-delivery-policy', expectedFact: 'inside-Dhaka delivery takes 1 to 2 days' }),
    freezeQuery({ queryId: 'bn-pickup-window', languageClass: 'bengali', query: 'ঢাকায় পার্সেল কখন সংগ্রহ করা যাবে?', expectedSourceId: 'fixture-dhaka-pickup', expectedFact: 'weekday pickup is available from 12:00 to 18:00' }),
    freezeQuery({ queryId: 'bn-cod', languageClass: 'bengali', query: 'ক্যাশ অন ডেলিভারি কি পাওয়া যায়?', expectedSourceId: 'fixture-cod-payment', expectedFact: 'cash on delivery is available across Bangladesh' }),
    freezeQuery({ queryId: 'bn-return', languageClass: 'bengali', query: 'পণ্য ফেরত দেওয়ার সময়সীমা কত?', expectedSourceId: 'fixture-return-policy', expectedFact: 'returns and exchanges are allowed within 7 days' }),
    freezeQuery({ queryId: 'bn-panjabi-size', languageClass: 'bengali', query: 'কালো পাঞ্জাবির কী কী সাইজ আছে?', expectedSourceId: 'fixture-black-panjabi', expectedFact: 'black cotton Panjabi sizes are M, L, and XL' }),
    freezeQuery({ queryId: 'bn-kurti-size', languageClass: 'bengali', query: 'টিল কুর্তির কোন কোন সাইজ আছে?', expectedSourceId: 'fixture-womens-kurti', expectedFact: 'teal womens kurti sizes are S, M, and L' }),
    freezeQuery({ queryId: 'bn-order', languageClass: 'bengali', query: 'অর্ডার করতে কী কী তথ্য পাঠাব?', expectedSourceId: 'fixture-order-process', expectedFact: 'an order needs product, size, address, and phone details' }),
    freezeQuery({ queryId: 'bn-gift-wrap', languageClass: 'bengali', query: 'উপহার মোড়ানোর ব্যবস্থা কি আছে?', expectedSourceId: 'fixture-gift-wrap', expectedFact: 'gift wrapping can be requested before dispatch' }),

    // English cases.
    freezeQuery({ queryId: 'en-opening-hours', languageClass: 'english', query: "What are the shop's opening hours?", expectedSourceId: 'fixture-shop-hours', expectedFact: 'daily opening hours are 10:00 to 20:00 Bangladesh time' }),
    freezeQuery({ queryId: 'en-contact', languageClass: 'english', query: 'Where is the shop contact channel for product questions?', expectedSourceId: 'fixture-shop-contact', expectedFact: 'the shop inbox is the contact channel' }),
    freezeQuery({ queryId: 'en-outside-dhaka-delivery', languageClass: 'english', query: 'How long does delivery outside Dhaka take?', expectedSourceId: 'fixture-delivery-policy', expectedFact: 'outside-Dhaka delivery takes 3 to 5 days' }),
    freezeQuery({ queryId: 'en-pickup-window', languageClass: 'english', query: 'When can a confirmed parcel be collected in Dhaka?', expectedSourceId: 'fixture-dhaka-pickup', expectedFact: 'weekday pickup is available from 12:00 to 18:00' }),
    freezeQuery({ queryId: 'en-cod', languageClass: 'english', query: 'Can I pay the courier when the parcel arrives?', expectedSourceId: 'fixture-cod-payment', expectedFact: 'cash on delivery is available across Bangladesh' }),
    freezeQuery({ queryId: 'en-bkash', languageClass: 'english', query: 'What bKash reference is needed for prepaid dispatch?', expectedSourceId: 'fixture-bkash-payment', expectedFact: 'the bKash transaction reference is sent before dispatch' }),
    freezeQuery({ queryId: 'en-return-window', languageClass: 'english', query: 'How many days are allowed for a return or exchange?', expectedSourceId: 'fixture-return-policy', expectedFact: 'returns and exchanges are allowed within 7 days' }),
    freezeQuery({ queryId: 'en-color-exchange', languageClass: 'english', query: 'Can the colour be changed before dispatch?', expectedSourceId: 'fixture-color-exchange', expectedFact: 'an unused item colour can be changed before dispatch if available' }),
    freezeQuery({ queryId: 'en-shoe-sizes', languageClass: 'english', query: 'Which shoe sizes are stocked for the brown sandals?', expectedSourceId: 'fixture-shoe-product', expectedFact: 'brown leather sandal sizes are 40, 41, and 42' }),
    freezeQuery({ queryId: 'en-size-guide', languageClass: 'english', query: 'How do I choose a clothing size before ordering?', expectedSourceId: 'fixture-size-guide', expectedFact: 'the size guide uses chest width' }),
    freezeQuery({ queryId: 'en-order-confirmation', languageClass: 'english', query: 'What does the shop check before dispatch?', expectedSourceId: 'fixture-order-confirmation', expectedFact: 'the shop checks the variant and address before dispatch' }),
    freezeQuery({ queryId: 'en-stock', languageClass: 'english', query: 'How many large black Panjabis are currently in stock?', expectedSourceId: 'fixture-panjabi-stock', expectedFact: 'two size L units are currently in stock' }),
    freezeQuery({ queryId: 'en-tracking', languageClass: 'english', query: 'When will I receive a parcel tracking code?', expectedSourceId: 'fixture-courier-tracking', expectedFact: 'a tracking code is sent when the parcel leaves the shop' }),
    freezeQuery({ queryId: 'en-gift-wrap', languageClass: 'english', query: 'Can the shop add gift wrapping and a greeting?', expectedSourceId: 'fixture-gift-wrap', expectedFact: 'gift wrapping and a short greeting can be requested before dispatch' }),

    // Genuine Bengali/English code-switched cases.
    freezeQuery({ queryId: 'mixed-dhaka-delivery', languageClass: 'cross_lingual', query: 'ঢাকার বাইরে delivery time কত?', expectedSourceId: 'fixture-delivery-policy', expectedFact: 'outside-Dhaka delivery takes 3 to 5 days' }),
    freezeQuery({ queryId: 'mixed-pickup', languageClass: 'cross_lingual', query: 'Dhaka pickup কখন available?', expectedSourceId: 'fixture-dhaka-pickup', expectedFact: 'weekday pickup is available from 12:00 to 18:00' }),
    freezeQuery({ queryId: 'mixed-bkash', languageClass: 'cross_lingual', query: 'prepaid order এর bKash reference কোথায় পাঠাব?', expectedSourceId: 'fixture-bkash-payment', expectedFact: 'the bKash transaction reference is sent before dispatch' }),
    freezeQuery({ queryId: 'mixed-return', languageClass: 'cross_lingual', query: 'return policy কত দিনের?', expectedSourceId: 'fixture-return-policy', expectedFact: 'returns and exchanges are allowed within 7 days' }),
    freezeQuery({ queryId: 'mixed-black-panjabi', languageClass: 'cross_lingual', query: 'black Panjabi এর available size কী?', expectedSourceId: 'fixture-black-panjabi', expectedFact: 'black cotton Panjabi sizes are M, L, and XL' }),
    freezeQuery({ queryId: 'mixed-kurti', languageClass: 'cross_lingual', query: 'teal kurti এর size কী কী?', expectedSourceId: 'fixture-womens-kurti', expectedFact: 'teal womens kurti sizes are S, M, and L' }),
    freezeQuery({ queryId: 'mixed-order', languageClass: 'cross_lingual', query: 'order করতে product আর address পাঠাব?', expectedSourceId: 'fixture-order-process', expectedFact: 'an order needs product, size, address, and phone details' }),
    freezeQuery({ queryId: 'mixed-confirmation', languageClass: 'cross_lingual', query: 'dispatch এর আগে shop কী check করে?', expectedSourceId: 'fixture-order-confirmation', expectedFact: 'the shop checks the variant and address before dispatch' }),
    freezeQuery({ queryId: 'mixed-stock', languageClass: 'cross_lingual', query: 'black Panjabi size L stock আছে?', expectedSourceId: 'fixture-panjabi-stock', expectedFact: 'two size L units are currently in stock' }),
    freezeQuery({ queryId: 'mixed-tracking', languageClass: 'cross_lingual', query: 'parcel leave করলে tracking code পাব?', expectedSourceId: 'fixture-courier-tracking', expectedFact: 'a tracking code is sent when the parcel leaves the shop' }),
    freezeQuery({ queryId: 'mixed-delay', languageClass: 'cross_lingual', query: 'courier delay হলে updated delivery estimate কোথায় পাব?', expectedSourceId: 'fixture-courier-delay', expectedFact: 'a delayed parcel receives an updated estimate through the shop inbox' }),
    freezeQuery({ queryId: 'mixed-kurti-care', languageClass: 'cross_lingual', query: 'teal kurti কীভাবে wash করে dry করব?', expectedSourceId: 'fixture-kurti-care', expectedFact: 'the kurti should be washed in cool water and dried in shade' }),
    freezeQuery({ queryId: 'mixed-sandal-care', languageClass: 'cross_lingual', query: 'leather sandal dry রাখার care কী?', expectedSourceId: 'fixture-sandal-care', expectedFact: 'leather sandals should be kept dry and wiped with a soft cloth' }),
    freezeQuery({ queryId: 'mixed-gift', languageClass: 'cross_lingual', query: 'gift wrap আর greeting request করা যাবে?', expectedSourceId: 'fixture-gift-wrap', expectedFact: 'gift wrapping and a short greeting can be requested before dispatch' }),
    freezeQuery({ queryId: 'mixed-contact', languageClass: 'cross_lingual', query: 'shop contact এর জন্য inbox ব্যবহার করব?', expectedSourceId: 'fixture-shop-contact', expectedFact: 'the shop inbox is the contact channel' }),
    freezeQuery({ queryId: 'mixed-size-guide', languageClass: 'cross_lingual', query: 'clothing size choose করতে chest measure করব?', expectedSourceId: 'fixture-size-guide', expectedFact: 'the size guide uses chest width' }),
]);

const CONTROLLED_NEGATIVE_QUERIES = Object.freeze([
    Object.freeze({ negativeQueryId: 'negative-astrophysics', query: 'quasar pulsar redshift' }),
    Object.freeze({ negativeQueryId: 'negative-marine-biology', query: 'coral plankton cetacean' }),
    Object.freeze({ negativeQueryId: 'negative-medieval-architecture', query: 'gothic buttress nave' }),
    Object.freeze({ negativeQueryId: 'negative-quantum-computing', query: 'qubit decoherence hadamard' }),
    Object.freeze({ negativeQueryId: 'negative-classical-music', query: 'counterpoint fugue sonata' }),
    Object.freeze({ negativeQueryId: 'negative-geology', query: 'igneous basalt stratigraphy' }),
    Object.freeze({ negativeQueryId: 'negative-aviation', query: 'aerodynamics turbine avionics' }),
    Object.freeze({ negativeQueryId: 'negative-paleontology', query: 'trilobite ammonite fossil' }),
    Object.freeze({ negativeQueryId: 'negative-botany', query: 'chlorophyll herbarium xylem' }),
    Object.freeze({ negativeQueryId: 'negative-volcanology', query: 'volcanology magma tectonics' }),
    Object.freeze({ negativeQueryId: 'negative-paleoclimate', query: 'paleoclimatology isotope glacier' }),
    Object.freeze({ negativeQueryId: 'negative-cartography', query: 'cartography meridian azimuth' }),
    Object.freeze({ negativeQueryId: 'negative-ornithology', query: 'ornithology albatross migration' }),
    Object.freeze({ negativeQueryId: 'negative-entomology', query: 'entomology coleoptera chrysalis' }),
    Object.freeze({ negativeQueryId: 'negative-oceanography', query: 'oceanography salinity thermocline' }),
    Object.freeze({ negativeQueryId: 'negative-seismology', query: 'seismology hypocenter aftershock' }),
    Object.freeze({ negativeQueryId: 'negative-topology', query: 'topology manifold homotopy' }),
    Object.freeze({ negativeQueryId: 'negative-cryptography', query: 'cryptography elliptic ciphertext' }),
    Object.freeze({ negativeQueryId: 'negative-compilers', query: 'compiler register allocation' }),
    Object.freeze({ negativeQueryId: 'negative-robotics', query: 'robotics lidar actuator' }),
    Object.freeze({ negativeQueryId: 'negative-metallurgy', query: 'metallurgy annealing alloy' }),
    Object.freeze({ negativeQueryId: 'negative-ceramics', query: 'ceramics kiln glaze' }),
    Object.freeze({ negativeQueryId: 'negative-astronomy', query: 'astronomy aphelion perihelion' }),
    Object.freeze({ negativeQueryId: 'negative-neuroscience', query: 'neuroscience synapse axon' }),
    Object.freeze({ negativeQueryId: 'negative-linguistics', query: 'linguistics phoneme morpheme' }),
    Object.freeze({ negativeQueryId: 'negative-archaeology', query: 'archaeology excavation cuneiform' }),
    Object.freeze({ negativeQueryId: 'negative-anthropology', query: 'anthropology ethnography kinship' }),
    Object.freeze({ negativeQueryId: 'negative-theatre', query: 'theatre dramaturgy soliloquy' }),
    Object.freeze({ negativeQueryId: 'negative-calligraphy', query: 'calligraphy nib inkstone' }),
    Object.freeze({ negativeQueryId: 'negative-hydrology', query: 'hydrology watershed aquifer' }),
    Object.freeze({ negativeQueryId: 'negative-meteorology', query: 'meteorology cumulonimbus barometer' }),
    Object.freeze({ negativeQueryId: 'negative-geophysics', query: 'geophysics magnetosphere ionosphere' }),
    Object.freeze({ negativeQueryId: 'negative-mathematics', query: 'mathematics eigenvalue polynomial' }),
    Object.freeze({ negativeQueryId: 'negative-materials', query: 'graphene lattice nanocomposite' }),
    Object.freeze({ negativeQueryId: 'negative-photography', query: 'photography aperture bokeh' }),
    Object.freeze({ negativeQueryId: 'negative-ceremonial-art', query: 'woodcut lithograph chiaroscuro' }),
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

function canonicalFixturePayload({ documents, positiveQueries, negativeQueries }) {
    return {
        documents: documents.map(({ fixtureId, sourceType, title, content, authoritativeFacts }) => ({
            fixtureId,
            sourceType,
            title,
            content,
            authoritativeFacts,
        })),
        positiveQueries: positiveQueries.map(({ queryId, languageClass, query, expectedSourceId, expectedFact }) => ({
            queryId,
            languageClass,
            query,
            expectedSourceId,
            expectedFact,
        })),
        negativeQueries: negativeQueries.map(({ negativeQueryId, query }) => ({ negativeQueryId, query })),
    };
}

function fixtureVersionFor({ documents, positiveQueries, negativeQueries } = {}) {
    return `sha256:${crypto.createHash('sha256')
        .update(JSON.stringify(canonicalFixturePayload({ documents, positiveQueries, negativeQueries })))
        .digest('hex')}`;
}

const FIXTURE_VERSION = fixtureVersionFor({
    documents: CONTROLLED_FIXTURE_DOCUMENTS,
    positiveQueries: CONTROLLED_POSITIVE_QUERIES,
    negativeQueries: CONTROLLED_NEGATIVE_QUERIES,
});

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
    CALIBRATION_DIMENSIONS,
    DIAGNOSTIC_DIMENSIONS,
    TOKEN_PATTERN,
    FIXTURE_VERSION,
    CONTROLLED_FIXTURE_DOCUMENTS,
    CONTROLLED_POSITIVE_QUERIES,
    CONTROLLED_NEGATIVE_QUERIES,
    normalizedTokens,
    lexicalOverlapTokens,
    fixtureSearchText,
    canonicalFixturePayload,
    fixtureVersionFor,
    validateCalibrationFixtures,
};
