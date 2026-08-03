#!/usr/bin/env node
'use strict';

/**
 * AI-cost payload measurement harness.
 *
 * Builds the REAL production prompt payloads (via the same
 * intent-router / product-search helpers the reply path uses) for a synthetic
 * BD f-commerce merchant, then measures token counts.
 *
 * Token counts are provider-reported via the Gemini `countTokens` endpoint
 * (free, non-generating, no content billed). If GEMINI_API_KEY is absent or the
 * call fails, it falls back to a calibrated character-ratio estimate and labels
 * the source accordingly.
 *
 * NOTHING here sends a customer message, generates content, or writes to any
 * datastore. Read-only measurement.
 *
 *   node scripts/ai-cost/measure-payloads.js            # human-readable
 *   node scripts/ai-cost/measure-payloads.js --json     # machine-readable
 */

require('dotenv').config();

const { buildSystemPrompt } = require('../../src/modules/ai/intent-router.service');
const { formatProductsForLlm } = require('../../src/modules/product/product-search.service');
const fixture = require('./fixture-bd-merchant');

const GEMINI_MODEL = process.env.LLM_GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

/**
 * Provider-reported token count via Gemini countTokens.
 * Returns null when unavailable so the caller can fall back and label the source.
 */
async function geminiCountTokens(text) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:countTokens?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
                signal: AbortSignal.timeout(20000),
            },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.totalTokens === 'number' ? data.totalTokens : null;
    } catch (_) {
        return null;
    }
}

/**
 * Fallback estimator. Bengali script is far denser per character than Latin
 * under SentencePiece/BPE, so the two are counted with separate ratios.
 * Ratios are calibrated against countTokens output when it is available
 * (see `calibrate` below) and otherwise use the documented defaults.
 */
let RATIO_LATIN = 3.9;   // chars per token
let RATIO_BENGALI = 1.5; // chars per token

const bengaliChars = (s) => (s.match(/[ঀ-৿]/g) || []).length;

function estimateTokens(text) {
    const bn = bengaliChars(text);
    const other = text.length - bn;
    return Math.ceil(bn / RATIO_BENGALI + other / RATIO_LATIN);
}

async function countTokens(text) {
    const reported = await geminiCountTokens(text);
    if (reported != null) return { tokens: reported, source: 'provider_reported' };
    return { tokens: estimateTokens(text), source: 'tokenizer_estimate' };
}

/** Derive the char/token ratios from real countTokens output. */
async function calibrate() {
    const latin = 'Assalamu alaikum. Is this cotton saree available in medium size and what is the delivery charge to Chittagong for cash on delivery?';
    const bengali = 'আসসালামু আলাইকুম। এই সুতির শাড়িটি মিডিয়াম সাইজে আছে কি? চট্টগ্রামে ক্যাশ অন ডেলিভারিতে ডেলিভারি চার্জ কত টাকা লাগবে জানালে ভালো হতো।';
    const [l, b] = await Promise.all([geminiCountTokens(latin), geminiCountTokens(bengali)]);
    if (l && b) {
        RATIO_LATIN = latin.length / l;
        RATIO_BENGALI = bengali.length / b;
        return { calibrated: true, ratioLatin: +RATIO_LATIN.toFixed(3), ratioBengali: +RATIO_BENGALI.toFixed(3) };
    }
    return { calibrated: false, ratioLatin: RATIO_LATIN, ratioBengali: RATIO_BENGALI };
}

// ---------------------------------------------------------------------------
// Payload assembly — mirrors intent-router._callLlm exactly
// ---------------------------------------------------------------------------

/** The COD-only branch of shop-operating-context.service.getOperatingContext. */
const OPERATING_CONTEXT_COD_ONLY = [
    "--- SHOP PAYMENT & DELIVERY (authoritative: this shop's CURRENT settings — follow strictly) ---",
    'Accepted payment: Cash on Delivery (COD) ONLY.',
    'Online / card / advance payment is NOT set up for this shop. Never ask the customer to pay first, send money in advance, or share a transaction ID/screenshot — payment is collected on delivery.',
    'If the customer sends a payment receipt or transaction screenshot, do NOT confirm or claim a payment was received. Politely explain this shop is Cash on Delivery (pay when the product arrives).',
    'Delivery: available nationwide across Bangladesh, shipped via Steadfast; a tracking number is available after dispatch.',
    "If any FAQ or knowledge text disagrees with the payment/delivery facts in THIS section, THIS section is correct — it reflects the shop's live settings.",
].join('\n');

const GROUNDING_RULES = [
    'GROUNDING RULES:',
    '- Only state prices, stock, and sizes listed above. Never invent or guess.',
    '- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.',
].join('\n');

const RAG_SUFFIX =
    'IMPORTANT: Only use the knowledge above. If the answer is not in the context, say you don\'t know or ask the customer to contact support.';

/**
 * Build the exact strings intent-router sends, for one turn.
 *
 * @param {object} opts
 * @param {number} opts.faqCount     FAQs injected into the system prompt
 * @param {number} opts.productCount grounded products injected
 * @param {number} opts.ragChunks    knowledge chunks injected
 * @param {number} opts.historyTurns prior messages replayed verbatim
 */
function buildTurnPayload({ faqCount, productCount, ragChunks, historyTurns, userMessage }) {
    const relevantFaqs = fixture.faqs.slice(0, faqCount);
    const systemPrompt = buildSystemPrompt(
        { businessInfo: fixture.businessInfo, brandingRules: {}, faqs: fixture.faqs },
        'mixed',
        false,
        'friendly_bd',
        relevantFaqs,
        OPERATING_CONTEXT_COD_ONLY,
    );

    let grounded = systemPrompt;

    if (productCount > 0) {
        grounded += `\n\nRELEVANT SHOP PRODUCTS (live data — use ONLY these facts):\n${formatProductsForLlm(
            fixture.products.slice(0, productCount),
        )}\n\n${GROUNDING_RULES}`;
    }

    if (ragChunks > 0) {
        const snippets = fixture.knowledgeChunks.slice(0, ragChunks).map((c) => c.trim()).join('\n---\n');
        grounded += `\n\nKNOWLEDGE BASE CONTEXT (use this to answer customer questions about the shop, delivery, products, and policies):\n${snippets}\n\n${RAG_SUFFIX}`;
    }

    const history = fixture.history.slice(0, historyTurns).map((h) => h.content).join('\n');

    return {
        systemPrompt,
        groundedSystemPrompt: grounded,
        dynamicGrounding: grounded.slice(systemPrompt.length).trim(),
        history,
        userMessage,
        fullInput: [grounded, history, userMessage].filter(Boolean).join('\n'),
    };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const TURN_SHAPES = [
    { id: 'base_system_prompt', faqCount: 0, productCount: 0, ragChunks: 0, historyTurns: 0, userMessage: '', note: 'Static per-shop persona + operating context, no FAQ/product/RAG' },
    { id: 'greeting_turn_no_llm', faqCount: 0, productCount: 0, ragChunks: 0, historyTurns: 0, userMessage: 'Assalamu alaikum', note: 'Regex fast-path — never reaches an LLM' },
    { id: 'turn_efficient', faqCount: 3, productCount: 2, ragChunks: 2, historyTurns: 4, userMessage: 'Ei saree ta ache?', note: 'Short Banglish, minimal retrieval' },
    { id: 'turn_expected', faqCount: 5, productCount: 5, ragChunks: 4, historyTurns: 8, userMessage: 'আপু এই কালো জামাটার দাম কত? মিডিয়াম সাইজ আছে? ঢাকার বাইরে ডেলিভারি চার্জ কত?', note: 'Production defaults: 5 FAQ, 5 products, 4 RAG, 8 history turns' },
    { id: 'turn_heavy', faqCount: 5, productCount: 5, ragChunks: 4, historyTurns: 10, userMessage: 'Bhaiya ei kalo jama tar dam koto? Medium size ache? Ar oi lal saree tao dekhan. Dhaka theke baire delivery charge koto lagbe, ar COD e kaj hobe to? Ekta order korte chai kintu age product er details janте chai.', note: 'Full 10-turn history, long mixed message' },
    { id: 'turn_no_cache_first_faq_stage', faqCount: 0, productCount: 0, ragChunks: 0, historyTurns: 0, userMessage: 'FAQ context:\nDelivery Charge\nA: Inside Dhaka 60 BDT, outside Dhaka 120 BDT\n\nCustomer question: delivery charge koto?\n\nRespond in language: mixed', note: 'Stage-2 FAQ-hit branch: full system prompt + tiny FAQ user turn' },
];

const OUTPUT_SAMPLES = [
    { id: 'reply_short_bn', text: 'জি আপু, এই জামাটা স্টকে আছে! দাম ১,২৫০ টাকা। মিডিয়াম সাইজ পাওয়া যাবে 😊' },
    { id: 'reply_typical_mixed', text: 'Ji apu, ei kalo jama ta stock e ache! Dam 1250 taka, medium size available 😊 Dhaka er baire delivery charge 120 taka, cash on delivery e nite parben. Order korte chaile product er nam likhe "order korbo" pathan!' },
    { id: 'reply_long', text: 'Ji bhaiya, ei kalo jama ta stock e ache — dam 1250 taka, medium ar large duitai available. Lal saree ta o ache, oita 2350 taka, free size. Dhaka er bhitore delivery 60 taka ar Dhaka er baire 120 taka lage, 2-3 din e pouche jabe. Amader shop e cash on delivery e kaj hoy, product hate peye taka diben 😊 Kon ta nite chan janan — product er nam likhe "order korbo" pathale order system ta shuru hoye jabe.' },
];

const EMBEDDING_SAMPLES = [
    { id: 'rag_query_short', text: 'Ei saree ta ache?' },
    { id: 'rag_query_expected', text: 'আপু এই কালো জামাটার দাম কত? মিডিয়াম সাইজ আছে? ঢাকার বাইরে ডেলিভারি চার্জ কত?' },
    { id: 'product_embed_doc', text: null }, // filled from fixture below
    { id: 'faq_embed_doc', text: 'Q: Delivery Charge\nA (BN): ঢাকার ভিতরে ৬০ টাকা, ঢাকার বাইরে ১২০ টাকা।\nA (EN): Inside Dhaka 60 BDT, outside Dhaka 120 BDT. Delivery takes 1-2 days inside Dhaka and 2-3 days outside.' },
];

const VISION_PROMPTS = [
    { id: 'intent_router_extraction_prompt', text: `You are a product image analyzer for an e-commerce platform.
Analyze this product image and return ONLY a JSON object (no markdown, no explanation):
{
  "category": "product type e.g. saree/shirt/panjabi/dress/shoes/bag",
  "color": "main color e.g. blue/red/white (null if unclear)",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "query": "best search term to find this product",
  "tags": ["max", "5", "search", "tags"]
}` },
    { id: 'product_ai_extraction_prompt', text: `You are a product image analyzer for an e-commerce platform.
Analyze the product image and return ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "category": "product category e.g. saree/shirt/panjabi/dress/shoes",
  "color_primary": "main color e.g. blue/red/white/black",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "style": "style descriptor e.g. traditional/casual/formal/printed (null if unclear)",
  "tags": ["array", "of", "search", "tags", "max 8"],
  "description": "1-2 sentence product description for search indexing",
  "search_text": "space-separated keywords for full-text search"
}` },
    { id: 'sentiment_system_prompt', text: `You are a sentiment classifier for a Bangladeshi e-commerce customer support platform.
Classify the customer message into exactly one of these four categories: positive, neutral, frustrated, angry.

Definitions:
- positive: happy, satisfied, complimenting the shop
- neutral: asking a question, requesting information, no strong emotion
- frustrated: dissatisfied, waiting too long, received wrong or damaged item, poor quality
- angry: rude, threatening, accusing fraud/scam/cheating, demanding refund aggressively

The message may be in Bengali (Bangla script), Banglish (Bengali written in English letters), English, or a mix.

Respond with ONLY a valid JSON object in this exact format (no extra text):
{"sentiment":"<category>","confidence":<0-100>,"reason":"<one short sentence>"}` },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
    const asJson = process.argv.includes('--json');
    const calibration = await calibrate();

    const { buildEmbeddingText } = require('../../src/modules/product/product-embedding.service');
    EMBEDDING_SAMPLES[2].text = buildEmbeddingText(fixture.products[0]);

    const result = {
        measuredAt: new Date().toISOString(),
        geminiModelUsedForCounting: GEMINI_MODEL,
        calibration,
        turns: [],
        outputs: [],
        embeddings: [],
        auxPrompts: [],
    };

    for (const shape of TURN_SHAPES) {
        const p = buildTurnPayload(shape);
        const [sys, grounded, dyn, hist, user, full] = await Promise.all([
            countTokens(p.systemPrompt),
            countTokens(p.groundedSystemPrompt),
            p.dynamicGrounding ? countTokens(p.dynamicGrounding) : Promise.resolve({ tokens: 0, source: 'n/a' }),
            p.history ? countTokens(p.history) : Promise.resolve({ tokens: 0, source: 'n/a' }),
            p.userMessage ? countTokens(p.userMessage) : Promise.resolve({ tokens: 0, source: 'n/a' }),
            countTokens(p.fullInput),
        ]);
        result.turns.push({
            id: shape.id,
            note: shape.note,
            shape: { faqCount: shape.faqCount, productCount: shape.productCount, ragChunks: shape.ragChunks, historyTurns: shape.historyTurns },
            chars: {
                systemPrompt: p.systemPrompt.length,
                groundedSystemPrompt: p.groundedSystemPrompt.length,
                dynamicGrounding: p.dynamicGrounding.length,
                history: p.history.length,
                userMessage: p.userMessage.length,
                fullInput: p.fullInput.length,
            },
            tokens: {
                systemPrompt: sys.tokens,
                groundedSystemPrompt: grounded.tokens,
                dynamicGrounding: dyn.tokens,
                history: hist.tokens,
                userMessage: user.tokens,
                totalInput: full.tokens,
            },
            measurementSource: full.source,
        });
    }

    for (const s of OUTPUT_SAMPLES) {
        const t = await countTokens(s.text);
        result.outputs.push({ id: s.id, chars: s.text.length, tokens: t.tokens, measurementSource: t.source });
    }

    for (const s of EMBEDDING_SAMPLES) {
        const t = await countTokens(s.text);
        result.embeddings.push({ id: s.id, chars: s.text.length, tokens: t.tokens, measurementSource: t.source });
    }

    for (const s of VISION_PROMPTS) {
        const t = await countTokens(s.text);
        result.auxPrompts.push({ id: s.id, chars: s.text.length, tokens: t.tokens, measurementSource: t.source });
    }

    if (asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }

    console.log(`\nMeasured ${result.measuredAt}  model=${GEMINI_MODEL}`);
    console.log(`Calibration: ${JSON.stringify(calibration)}\n`);
    console.log('TURN INPUT PAYLOADS');
    for (const t of result.turns) {
        console.log(
            `  ${t.id.padEnd(30)} sys=${String(t.tokens.systemPrompt).padStart(5)}  ` +
            `dyn=${String(t.tokens.dynamicGrounding).padStart(5)}  hist=${String(t.tokens.history).padStart(4)}  ` +
            `user=${String(t.tokens.userMessage).padStart(4)}  TOTAL=${String(t.tokens.totalInput).padStart(5)}  [${t.measurementSource}]`,
        );
    }
    console.log('\nOUTPUT SAMPLES');
    for (const o of result.outputs) console.log(`  ${o.id.padEnd(30)} ${String(o.tokens).padStart(5)} tokens (${o.chars} chars) [${o.measurementSource}]`);
    console.log('\nEMBEDDING INPUTS');
    for (const e of result.embeddings) console.log(`  ${e.id.padEnd(30)} ${String(e.tokens).padStart(5)} tokens (${e.chars} chars) [${e.measurementSource}]`);
    console.log('\nAUX PROMPTS');
    for (const a of result.auxPrompts) console.log(`  ${a.id.padEnd(30)} ${String(a.tokens).padStart(5)} tokens (${a.chars} chars) [${a.measurementSource}]`);
    console.log();
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
