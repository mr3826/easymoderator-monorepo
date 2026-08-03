#!/usr/bin/env node
'use strict';

/**
 * Provider-reported usage metadata probe.
 *
 * Issues a SMALL number of real generateContent calls (maxOutputTokens capped
 * low) against the production model chain using the real assembled prompt, and
 * prints the provider's own `usageMetadata` — the authoritative billing record.
 *
 * This is the only way to observe:
 *   - promptTokenCount as Google actually bills it (incl. image tokens)
 *   - cachedContentTokenCount (does implicit caching engage at our prompt size?)
 *   - promptTokensDetails per modality
 *
 * Cost of a full run is a fraction of a US cent. No customer is contacted, no
 * datastore is written, no production behaviour is altered.
 *
 *   node scripts/ai-cost/probe-usage-metadata.js [--json] [--openai]
 */

require('dotenv').config();
const zlib = require('zlib');

const GEMINI_LITE = process.env.LLM_GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';
const OPENAI_MODEL = process.env.LLM_OPENAI_MODEL || 'gpt-4.1-mini';

const { buildSystemPrompt } = require('../../src/modules/ai/intent-router.service');
const { formatProductsForLlm } = require('../../src/modules/product/product-search.service');
const fixture = require('./fixture-bd-merchant');

// Reuse the exact assembly used by measure-payloads.js
const OPERATING_CONTEXT_COD_ONLY = [
    "--- SHOP PAYMENT & DELIVERY (authoritative: this shop's CURRENT settings — follow strictly) ---",
    'Accepted payment: Cash on Delivery (COD) ONLY.',
    'Online / card / advance payment is NOT set up for this shop. Never ask the customer to pay first, send money in advance, or share a transaction ID/screenshot — payment is collected on delivery.',
    'If the customer sends a payment receipt or transaction screenshot, do NOT confirm or claim a payment was received. Politely explain this shop is Cash on Delivery (pay when the product arrives).',
    'Delivery: available nationwide across Bangladesh, shipped via Steadfast; a tracking number is available after dispatch.',
    "If any FAQ or knowledge text disagrees with the payment/delivery facts in THIS section, THIS section is correct — it reflects the shop's live settings.",
].join('\n');

function buildExpectedTurn() {
    const systemPrompt = buildSystemPrompt(
        { businessInfo: fixture.businessInfo, brandingRules: {}, faqs: fixture.faqs },
        'mixed', false, 'friendly_bd', fixture.faqs.slice(0, 5), OPERATING_CONTEXT_COD_ONLY,
    );
    const grounded = `${systemPrompt}\n\nRELEVANT SHOP PRODUCTS (live data — use ONLY these facts):\n` +
        `${formatProductsForLlm(fixture.products.slice(0, 5))}\n\nGROUNDING RULES:\n` +
        '- Only state prices, stock, and sizes listed above. Never invent or guess.\n' +
        '- If a product is OUT OF STOCK, say so clearly and do not offer to process an order.\n\n' +
        'KNOWLEDGE BASE CONTEXT (use this to answer customer questions about the shop, delivery, products, and policies):\n' +
        `${fixture.knowledgeChunks.slice(0, 4).join('\n---\n')}\n\n` +
        "IMPORTANT: Only use the knowledge above. If the answer is not in the context, say you don't know or ask the customer to contact support.";

    const messages = fixture.history.slice(0, 8).map((h) => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }],
    }));
    messages.push({ role: 'user', parts: [{ text: 'আপু এই কালো জামাটার দাম কত? মিডিয়াম সাইজ আছে? ঢাকার বাইরে ডেলিভারি চার্জ কত?' }] });
    return { systemPrompt: grounded, messages };
}

// ── PNG generator (same as measure-image-tokens.js) ─────────────────────────
function crc32(buf) {
    const table = crc32.table || (crc32.table = (() => {
        const t = new Int32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
        return t;
    })());
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function makePng(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    const rowBytes = width * 3;
    const raw = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y++) {
        const off = y * (rowBytes + 1);
        for (let x = 0; x < width; x++) {
            const p = off + 1 + x * 3;
            raw[p] = (x * 7) & 0xff; raw[p + 1] = (y * 5) & 0xff; raw[p + 2] = ((x + y) * 3) & 0xff;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
    ]);
}

async function callGemini(label, { systemPrompt, contents, model, maxOutputTokens = 64 }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { label, error: 'GEMINI_API_KEY not set' };
    const body = { contents, generationConfig: { maxOutputTokens, temperature: 0.3 } };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) },
        );
        if (!res.ok) return { label, model, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
        const data = await res.json();
        return { label, model, usageMetadata: data.usageMetadata || null, finishReason: data?.candidates?.[0]?.finishReason || null };
    } catch (err) {
        return { label, model, error: err.message };
    }
}

async function callOpenAI(label, { systemPrompt, messages, maxTokens = 64 }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { label, error: 'OPENAI_API_KEY not set' };
    const oai = [];
    if (systemPrompt) oai.push({ role: 'system', content: systemPrompt });
    oai.push(...messages);
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: OPENAI_MODEL, messages: oai, max_tokens: maxTokens, temperature: 0.3 }),
            signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) return { label, model: OPENAI_MODEL, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
        const data = await res.json();
        return { label, model: OPENAI_MODEL, usage: data.usage || null };
    } catch (err) {
        return { label, model: OPENAI_MODEL, error: err.message };
    }
}

async function main() {
    const turn = buildExpectedTurn();
    const probes = [];

    // 1. Text-only expected turn on the production primary model.
    probes.push(await callGemini('gemini_lite_text_expected_turn', {
        systemPrompt: turn.systemPrompt, contents: turn.messages, model: GEMINI_LITE,
    }));

    // 2. Same turn again — reveals whether implicit caching engages on repeat.
    probes.push(await callGemini('gemini_lite_text_expected_turn_REPEAT', {
        systemPrompt: turn.systemPrompt, contents: turn.messages, model: GEMINI_LITE,
    }));

    // 3. One image + the intent-router extraction prompt (the vision phase-1 call).
    const png = makePng(720, 960);
    probes.push(await callGemini('gemini_lite_vision_extraction_1image', {
        systemPrompt: `You are a product image analyzer for an e-commerce platform.
Analyze this product image and return ONLY a JSON object (no markdown, no explanation):
{
  "category": "product type e.g. saree/shirt/panjabi/dress/shoes/bag",
  "color": "main color e.g. blue/red/white (null if unclear)",
  "material": "fabric/material e.g. cotton/silk/polyester (null if unclear)",
  "query": "best search term to find this product",
  "tags": ["max", "5", "search", "tags"]
}`,
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
                { text: 'Customer message: "eita ache?". Identify the product shown.' },
            ],
        }],
        model: GEMINI_LITE,
        maxOutputTokens: 150,
    }));

    // 4. Explicit-cache creation.
    //    (a) against the model gemini-cache.service actually defaults to — proves
    //        the configured cache model is unusable;
    //    (b) against the models that really answer — proves whether fixing the
    //        model argument alone would be enough (it also surfaces the project's
    //        billing tier via the caching quota).
    const cacheModels = [
        ['explicit_cache_create_configured_model', process.env.LLM_DEFAULT_MODEL_GEMINI || 'gemini-2.0-flash'],
        ['explicit_cache_create_actual_primary', GEMINI_LITE],
        ['explicit_cache_create_actual_fallback', process.env.LLM_GEMINI_PRO_MODEL || 'gemini-3.1-pro-preview'],
    ];
    for (const [label, cacheModel] of cacheModels) {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${cacheModel}`,
                    systemInstruction: { parts: [{ text: turn.systemPrompt }] },
                    ttl: '60s',
                    contents: [{ role: 'user', parts: [{ text: '.' }] }],
                }),
                signal: AbortSignal.timeout(60000),
            });
            const text = await res.text();
            probes.push({ label, model: cacheModel, httpStatus: res.status, ok: res.ok, responseSnippet: text.replace(/\s+/g, ' ').slice(0, 300) });
            if (res.ok) {
                // Clean up immediately — never leave a paid cache resource behind.
                const name = JSON.parse(text)?.name;
                if (name) await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {});
            }
        } catch (err) {
            probes.push({ label, model: cacheModel, error: err.message });
        }
    }

    if (process.argv.includes('--openai')) {
        probes.push(await callOpenAI('openai_fallback_text_expected_turn', {
            systemPrompt: turn.systemPrompt,
            messages: fixture.history.slice(0, 8).map((h) => ({ role: h.role, content: h.content }))
                .concat([{ role: 'user', content: 'আপু এই কালো জামাটার দাম কত? মিডিয়াম সাইজ আছে? ঢাকার বাইরে ডেলিভারি চার্জ কত?' }]),
        }));
    }

    const out = { probedAt: new Date().toISOString(), probes };
    if (process.argv.includes('--json')) { process.stdout.write(`${JSON.stringify(out, null, 2)}\n`); return; }
    console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
