'use strict';

/**
 * Retrieval-quality evaluation dataset for EasyModerator.
 *
 * Extends the AI-cost fixture (scripts/ai-cost/fixture-bd-merchant.js) with the
 * adversarial cases a real BD f-commerce catalogue produces and that the cost
 * fixture deliberately did not model:
 *   - three products whose names differ only by a trailing qualifier
 *   - two products with near-identical descriptions
 *   - a brand-style product name customers shorten
 *   - a product whose colour lives in the Bengali name only
 *
 * TWO CATALOGUE STATES are exported, because they retrieve very differently:
 *
 *   asShipped  — ai_search_text / ai_category / ai_color_primary / ai_material
 *                are NULL. This is what production actually stores today:
 *                those columns are written ONLY by product-ai.service.js, which
 *                requires a product image, and no image-upload path exists.
 *   enriched   — the same columns populated from TEXT fields (no vision), i.e.
 *                what the minimal locked-decision-compliant fix would produce.
 *
 * Entirely synthetic. No production data, no PII.
 */

const base = require('../ai-cost/fixture-bd-merchant');

const pid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const SHOP_ID = '00000000-0000-4000-8000-ffffffffffff';

// ---------------------------------------------------------------------------
// Adversarial products (ids 30–35)
// ---------------------------------------------------------------------------

// Two sarees that differ ONLY in the trailing qualifier and share a description
// verbatim except for one clause — the "nearly identical descriptions" case.
const TWIN_DESC =
    'Soft cotton saree woven in Tangail. 12 hand width, comes with an unstitched '
    + 'blouse piece of 0.8 metre. Colour-fast, breathable, suited to Bangladeshi weather.';

const EXTRA = [
    {
        i: 30, name: 'Cotton Panjabi Premium', name_bn: 'কটন পাঞ্জাবি প্রিমিয়াম',
        category: 'Panjabi', price: 2200, material: 'cotton', color: 'Off White',
        description: 'Premium 60-count cotton panjabi with a hand-stitched collar and chikan work on the placket.',
        tags: ['panjabi', 'eid-collection', 'premium'],
    },
    {
        i: 31, name: 'Cotton Panjabi Classic', name_bn: 'কটন পাঞ্জাবি ক্লাসিক',
        category: 'Panjabi', price: 1600, material: 'cotton', color: 'Navy',
        description: 'Classic plain cotton panjabi, regular fit, full sleeve, no embroidery.',
        tags: ['panjabi', 'eid-collection', 'classic'],
    },
    {
        i: 32, name: 'Soft Cotton Saree Deluxe', name_bn: 'সফট কটন শাড়ি ডিলাক্স',
        category: 'Saree', price: 1950, material: 'cotton', color: 'Maroon',
        description: `${TWIN_DESC} The Deluxe adds a contrast zari border.`,
        tags: ['saree', 'tangail', 'deluxe'],
    },
    {
        i: 33, name: 'Soft Cotton Saree Classic', name_bn: 'সফট কটন শাড়ি ক্লাসিক',
        category: 'Saree', price: 1750, material: 'cotton', color: 'Navy',
        description: `${TWIN_DESC} The Classic has a plain self border.`,
        tags: ['saree', 'tangail', 'classic'],
    },
    {
        i: 34, name: 'Nayantara Silk Saree', name_bn: 'নয়নতারা সিল্ক শাড়ি',
        category: 'Saree', price: 5200, material: 'silk', color: 'Maroon',
        description: 'Signature Nayantara silk saree with a broad temple border and a matching stitched blouse.',
        tags: ['saree', 'silk', 'nayantara', 'bridal'],
    },
    {
        i: 35, name: 'Mehedi Green Three Piece', name_bn: 'মেহেদি সবুজ থ্রি পিস',
        category: 'Three Piece', price: 2450, material: 'cotton', color: 'Green',
        description: 'Mehedi green three piece with printed kameez, solid salwar and a chiffon orna.',
        tags: ['three-piece', 'eid-collection', 'green'],
    },
].map(({ i, name, name_bn, category, price, material, color, description, tags }) => ({
    id: pid(i),
    name,
    name_bn,
    category,
    price,
    compare_at_price: null,
    quantity: 8,
    in_stock: true,
    is_active: true,
    brand: 'Rongdhonu',
    sku: `RD-${1000 + i}`,
    tags,
    variants: [
        { size: 'M', option: 'Size', value: 'M' },
        { size: 'L', option: 'Size', value: 'L' },
        { option: 'Color', value: color },
    ],
    description,
    ai_description: description,
    ai_tags: [category.toLowerCase(), color.toLowerCase(), material],
    ai_category: category,
    ai_color_primary: color,
    ai_material: material,
    ai_attributes: { style: 'traditional' },
}));

const ALL_PRODUCTS = [...base.products, ...EXTRA].map((p) => ({ ...p, shop_id: SHOP_ID }));

/**
 * Text-only derivation of the ai_* search columns.
 *
 * Mirrors what product-ai.service.js builds from a vision response, but sourced
 * from name / name_bn / category / tags / description. This is the candidate fix
 * evaluated as `enriched` — it involves no image bytes and no vision provider.
 */
const deriveSearchText = (p) => [
    p.name,
    p.name_bn,
    p.category,
    p.brand,
    p.sku,
    (p.tags || []).join(' '),
    p.description,
].filter(Boolean).join(' ').toLowerCase();

/** Production today: the vision-written columns are all NULL. */
const asShipped = () => ALL_PRODUCTS.map((p) => ({
    ...p,
    ai_search_text: null,
    ai_category: null,
    ai_color_primary: null,
    ai_material: null,
    ai_description: null,
    ai_tags: [],
    ai_attributes: {},
}));

/** Candidate fix: same columns derived from text only. */
const enriched = () => ALL_PRODUCTS.map((p) => ({
    ...p,
    ai_search_text: deriveSearchText(p),
    ai_category: p.category,
    // Colour/material stay text-derived: taken from the Color variant and the
    // tag list, never from an image.
    ai_color_primary: (p.variants || []).find((v) => v.option === 'Color')?.value || null,
    ai_material: p.ai_material || null,
    ai_description: p.description || null,
    ai_tags: p.tags || [],
}));

// ---------------------------------------------------------------------------
// Query set
// ---------------------------------------------------------------------------
// kind: 'product' → expect lists every acceptable product index
//       'faq'     → expectFaq is the FAQ category that should answer it
//       'none'    → nothing in the catalogue matches; returning a product is a
//                   false positive that leads the LLM to ground on a wrong item
//
// `lang` and `trait` drive the per-slice breakdown in the report.

const Q = (id, query, kind, expect, lang, trait, expectFaq) =>
    ({ id, query, kind, expect: (expect || []).map(pid), lang, trait, expectFaq: expectFaq || null });

const queries = [
    // ── Bengali script, direct product ────────────────────────────────────────
    Q('bn-01', 'কটন জামদানি শাড়ি আছে?', 'product', [0], 'bn', 'direct'),
    Q('bn-02', 'কালো জর্জেট কুর্তি দাম কত?', 'product', [13], 'bn', 'price'),
    Q('bn-03', 'সিল্ক পাঞ্জাবি দেখান', 'product', [16], 'bn', 'direct'),
    Q('bn-04', 'ঢাকাই মসলিন শাড়ি স্টকে আছে?', 'product', [3], 'bn', 'stock'),
    Q('bn-05', 'আনারকলি কুর্তি কত টাকা?', 'product', [12], 'bn', 'price'),
    Q('bn-06', 'জুট টোট ব্যাগ লাগবে', 'product', [26], 'bn', 'direct'),
    Q('bn-07', 'মেহেদি সবুজ থ্রি পিস আছে নাকি', 'product', [35], 'bn', 'direct'),
    Q('bn-08', 'ডেনিম শার্ট এর দাম জানতে চাই', 'product', [23], 'bn', 'price'),

    // ── English, direct product ──────────────────────────────────────────────
    Q('en-01', 'do you have the cotton jamdani saree', 'product', [0], 'en', 'direct'),
    Q('en-02', 'price of black georgette kurti', 'product', [13], 'en', 'price'),
    Q('en-03', 'show me silk panjabi', 'product', [16], 'en', 'direct'),
    Q('en-04', 'is the dhakai muslin saree in stock', 'product', [3], 'en', 'stock'),
    Q('en-05', 'i want a canvas backpack', 'product', [27], 'en', 'direct'),
    Q('en-06', 'linen straight kurti available?', 'product', [11], 'en', 'stock'),
    Q('en-07', 'how much is the travel duffel bag', 'product', [29], 'en', 'price'),
    Q('en-08', 'half sleeve polo price please', 'product', [22], 'en', 'price'),

    // ── Banglish (romanised Bengali) ─────────────────────────────────────────
    Q('bl-01', 'kalo georgette kurti ache?', 'product', [13], 'banglish', 'direct'),
    Q('bl-02', 'cotton panjabi er daam koto', 'product', [15, 30, 31], 'banglish', 'price'),
    Q('bl-03', 'silk katan saree dekhte chai', 'product', [1], 'banglish', 'direct'),
    Q('bl-04', 'jute tote bag koto taka', 'product', [26], 'banglish', 'price'),
    Q('bl-05', 'denim kurti ta nibo', 'product', [14], 'banglish', 'direct'),
    Q('bl-06', 'clutch purse ache naki', 'product', [28], 'banglish', 'stock'),
    Q('bl-07', 'formal shirt lagbe amar', 'product', [20], 'banglish', 'direct'),

    // ── Phonetic Bengali typed in English (no English product word at all) ───
    Q('ph-01', 'lal shari ache?', 'product', [], 'phonetic', 'phonetic_none'),
    Q('ph-02', 'shari dekhao', 'product', [0, 1, 2, 3, 4, 32, 33, 34], 'phonetic', 'phonetic_category'),
    Q('ph-03', 'panjabi er dam koto', 'product', [15, 16, 17, 19, 30, 31], 'phonetic', 'phonetic_category'),
    Q('ph-04', 'kurti gulo dekhte chai', 'product', [10, 11, 12, 13, 14], 'phonetic', 'phonetic_category'),
    Q('ph-05', 'jama kapor ki ache', 'product', [], 'phonetic', 'phonetic_generic'),
    Q('ph-06', 'byag ache?', 'product', [25, 26, 27, 28, 29], 'phonetic', 'phonetic_category'),

    // ── Spelling mistakes ───────────────────────────────────────────────────
    Q('sp-01', 'cotan jamdani sari price', 'product', [0], 'en', 'typo'),
    Q('sp-02', 'geogette kurti', 'product', [13], 'en', 'typo'),
    Q('sp-03', 'panjabee available?', 'product', [15, 16, 17, 19, 30, 31], 'en', 'typo'),
    Q('sp-04', 'anarkoli kurti dam', 'product', [12], 'banglish', 'typo'),
    Q('sp-05', 'sarree koto', 'product', [0, 1, 2, 3, 4, 32, 33, 34], 'en', 'typo'),
    Q('sp-06', 'bakpack price', 'product', [27], 'en', 'typo'),

    // ── Synonyms ────────────────────────────────────────────────────────────
    Q('sy-01', 'salwar kameez set price', 'product', [5, 6, 7, 8, 9, 35], 'en', 'synonym'),
    Q('sy-02', 'kurta for men', 'product', [15, 16, 17, 19, 30, 31], 'en', 'synonym'),
    Q('sy-03', 'handbag options', 'product', [25, 26, 27, 28, 29], 'en', 'synonym'),
    Q('sy-04', 'rucksack available', 'product', [27], 'en', 'synonym'),
    Q('sy-05', 'tee shirt ache?', 'product', [22], 'banglish', 'synonym'),

    // ── Shortened product names ─────────────────────────────────────────────
    Q('sh-01', 'nayantara ta ache?', 'product', [34], 'banglish', 'shortname'),
    Q('sh-02', 'kabli set', 'product', [18], 'en', 'shortname'),
    Q('sh-03', 'muslin ta koto', 'product', [3], 'banglish', 'shortname'),
    Q('sh-04', 'tangail saree', 'product', [2, 32, 33], 'en', 'shortname'),
    Q('sh-05', 'karchupi', 'product', [7], 'en', 'shortname'),

    // ── Indirect descriptions ───────────────────────────────────────────────
    Q('in-01', 'something to wear at a wedding, silk', 'product', [1, 16, 34], 'en', 'indirect'),
    Q('in-02', 'looking for a light summer top for daily use', 'product', [10, 11, 13, 14], 'en', 'indirect'),
    Q('in-03', 'need a bag i can carry a laptop in', 'product', [27, 29], 'en', 'indirect'),
    Q('in-04', 'eid er jonno kichu dekhan', 'product', [], 'banglish', 'indirect'),
    Q('in-05', 'gift for my mother, traditional', 'product', [0, 1, 2, 3, 4, 32, 33, 34], 'en', 'indirect'),

    // ── Category questions ──────────────────────────────────────────────────
    Q('ct-01', 'what sarees do you have', 'product', [0, 1, 2, 3, 4, 32, 33, 34], 'en', 'category'),
    Q('ct-02', 'three piece collection dekhan', 'product', [5, 6, 7, 8, 9, 35], 'banglish', 'category'),
    Q('ct-03', 'শার্ট কি কি আছে', 'product', [20, 21, 22, 23, 24], 'bn', 'category'),
    Q('ct-04', 'bag gulo dekhte chai', 'product', [25, 26, 27, 28, 29], 'banglish', 'category'),

    // ── Price questions on a specific item ──────────────────────────────────
    Q('pr-01', 'kabli set er price koto', 'product', [18], 'banglish', 'price'),
    Q('pr-02', 'leather side bag dam', 'product', [25], 'banglish', 'price'),
    Q('pr-03', 'ব্লক প্রিন্ট কটন শাড়ি মূল্য', 'product', [4], 'bn', 'price'),

    // ── Size and colour ─────────────────────────────────────────────────────
    Q('sz-01', 'printed kurti medium size ache?', 'product', [10], 'banglish', 'size'),
    Q('sz-02', 'cotton panjabi xl size hobe', 'product', [15, 30, 31], 'banglish', 'size'),
    Q('sz-03', 'navy colour saree ache?', 'product', [33], 'en', 'color'),
    Q('sz-04', 'maroon three piece', 'product', [], 'en', 'color'),
    Q('sz-05', 'সবুজ থ্রি পিস আছে?', 'product', [35], 'bn', 'color'),

    // ── Stock ───────────────────────────────────────────────────────────────
    Q('st-01', 'cotton jamdani saree stock ache?', 'product', [0], 'banglish', 'stock'),
    Q('st-02', 'denim kurti ta ki stock e ache', 'product', [14], 'banglish', 'stock'),
    Q('st-03', 'check casual shirt paoa jabe?', 'product', [21], 'banglish', 'stock'),

    // ── Overlapping names (must not collapse to one) ────────────────────────
    Q('ov-01', 'cotton panjabi premium', 'product', [30], 'en', 'overlap'),
    Q('ov-02', 'cotton panjabi classic er dam', 'product', [31], 'banglish', 'overlap'),
    Q('ov-03', 'kon cotton panjabi ta sob theke kom dame', 'product', [15, 30, 31], 'banglish', 'overlap'),

    // ── Near-identical descriptions ─────────────────────────────────────────
    Q('nd-01', 'soft cotton saree deluxe', 'product', [32], 'en', 'twin'),
    Q('nd-02', 'soft cotton saree classic price', 'product', [33], 'en', 'twin'),
    Q('nd-03', 'which soft cotton saree has a zari border', 'product', [32], 'en', 'twin'),

    // ── No matching product exists ──────────────────────────────────────────
    Q('no-01', 'do you sell mobile phone', 'none', [], 'en', 'absent'),
    Q('no-02', 'iphone 15 er dam koto', 'none', [], 'banglish', 'absent'),
    Q('no-03', 'বেবি ডায়াপার আছে?', 'none', [], 'bn', 'absent'),
    Q('no-04', 'gold necklace price', 'none', [], 'en', 'absent'),
    Q('no-05', 'football boot lagbe', 'none', [], 'banglish', 'absent'),

    // ── Should resolve to a shop FAQ, not a product ──────────────────────────
    Q('fq-01', 'delivery charge koto', 'faq', [], 'banglish', 'faq', 'Delivery Charge'),
    Q('fq-02', 'ডেলিভারি চার্জ কত টাকা', 'faq', [], 'bn', 'faq', 'Delivery Charge'),
    Q('fq-03', 'cash on delivery ache?', 'faq', [], 'banglish', 'faq', 'Payment Method'),
    Q('fq-04', 'can i pay after receiving the product', 'faq', [], 'en', 'faq', 'Payment Method'),
    Q('fq-05', 'return policy ki', 'faq', [], 'banglish', 'faq', 'Return Policy'),
    Q('fq-06', 'size chart dekhte chai', 'faq', [], 'banglish', 'faq', 'Size Chart'),
    Q('fq-07', 'কত দিনে ডেলিভারি হয়', 'faq', [], 'bn', 'faq', 'Delivery Charge'),
    Q('fq-08', 'do you deliver outside dhaka', 'faq', [], 'en', 'faq', 'Delivery Area'),
    Q('fq-09', 'bulk order e discount ache?', 'faq', [], 'banglish', 'faq', 'Bulk Order'),
    Q('fq-10', 'advance payment lagbe?', 'faq', [], 'banglish', 'faq', 'Advance Payment'),
];

module.exports = {
    SHOP_ID,
    pid,
    asShipped,
    enriched,
    deriveSearchText,
    queries,
    faqs: base.faqs,
    knowledgeChunks: base.knowledgeChunks,
    allProducts: ALL_PRODUCTS,
};
