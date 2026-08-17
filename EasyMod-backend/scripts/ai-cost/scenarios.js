'use strict';

/**
 * EasyModerator AI cost scenario model — DATA ONLY.
 *
 * Every token figure below is one of:
 *   [P] provider_reported     — Gemini usageMetadata / OpenAI usage from a real call
 *   [T] tokenizer_estimate    — Gemini countTokens on the real assembled payload
 *   [S] scenario_assumption   — a stated traffic/behaviour assumption
 *
 * Nothing here is guessed from a character count. Re-measure with:
 *   node scripts/ai-cost/measure-payloads.js --json
 *   node scripts/ai-cost/measure-image-tokens.js --json
 *   node scripts/ai-cost/probe-usage-metadata.js --json --openai
 */

const P = 'provider_reported';
const T = 'tokenizer_estimate';
const S = 'scenario_assumption';

// ── Production model chain (llm.service.js:27-29 defaults; no LLM_* key is
//    rendered into the deployed .env.prod by scripts/render-production-env.js) ──
const M = {
    LITE: 'gemini-3.1-flash-lite',
    PRO: 'gemini-3.1-pro-preview',
    OAI: 'gpt-4.1-mini',
    EMBED_LOCAL: 'local-ngram',
    EMBED_OPENAI: 'text-embedding-3-small',
};

// ── Measured token constants ────────────────────────────────────────────────
const TOK = {
    // System prompts, built by the real intentRouter.buildSystemPrompt()
    SYS_TEXT_5FAQ: 1251,          // [T] text path: relevantFaqs = top 5
    SYS_IMAGE_FULLFAQ_12: 1508,   // [T] image path: relevantFaqs=null → full FAQ dump, 12-FAQ shop
    SYS_IMAGE_FULLFAQ_50: 2554,   // [T] image path, 50-FAQ shop (MAX_FAQ_IN_PROMPT cap)

    // Dynamic grounding appended to the system prompt
    GROUND_2P_2RAG: 376,          // [T] 2 products + 2 knowledge chunks
    GROUND_5P_4RAG: 746,          // [T] 5 products + 4 knowledge chunks (production limits)

    // Verbatim conversation history (CONTEXT_WINDOW = 10, no summarisation)
    HIST_4: 75,                   // [T]
    HIST_8: 134,                  // [T]
    HIST_10: 182,                 // [T]

    // Customer messages
    USER_SHORT: 6,                // [T] "Ei saree ta ache?"
    USER_EXPECTED: 25,            // [T] Bengali multi-part question
    USER_LONG: 59,                // [T] long mixed Banglish message

    // One image, Gemini 3.1 Flash-Lite, default media_resolution
    IMAGE_GEMINI: 1064,           // [P] promptTokensDetails modality=IMAGE, 720x960
    IMAGE_GEMINI_384: 1090,       // [P] 384x384 — SMALLER images cost MORE, see assumptions
    IMAGE_OPENAI_512: 429,        // [P] gpt-4.1-mini, 512x512 (2533-40 text)
    IMAGE_OPENAI_1080x1440: 2493, // [P] gpt-4.1-mini, 1080x1440

    // Replies
    OUT_SHORT: 45,                // [T] one-line Banglish confirmation
    OUT_TYPICAL: 80,              // [T] 2-3 sentence reply (measured sample: 63)
    OUT_LONG: 130,                // [T] multi-product reply (measured sample: 127)

    // Auxiliary prompts
    SENTIMENT_SYS: 176,           // [T] SENTIMENT_SYSTEM_PROMPT
    SENTIMENT_OUT: 40,            // [S] {"sentiment":..,"confidence":..,"reason":".."}
    VISION_EXTRACT_SYS: 138,      // [T] EXTRACTION_PROMPT in intent-router
    VISION_EXTRACT_TEXT: 20,      // [T] "Customer message: ... Identify the product shown."
    VISION_EXTRACT_OUT: 55,       // [P] measured candidatesTokenCount 59, capped at 150
    PRODUCT_AI_SYS: 189,          // [T] ATTRIBUTE_EXTRACTION_PROMPT in product-ai.service
    PRODUCT_AI_OUT: 180,          // [S] 7-field JSON incl. description, capped at 300

    // Stage-2 FAQ branch: systemPrompt + one small user turn, NO history
    FAQ_BRANCH_USER: 41,          // [T]

    // Embeddings
    EMB_QUERY_SHORT: 6,           // [T]
    EMB_QUERY_EXPECTED: 25,       // [T]
    EMB_PRODUCT_DOC: 106,         // [T] buildEmbeddingText() output for a real product
    EMB_FAQ_DOC: 60,              // [T]
};

// Provider-reported cross-check: the assembled "expected" turn billed at
// promptTokenCount = 2155 on gemini-3.1-flash-lite and prompt_tokens = 2125 on
// gpt-4.1-mini. The component sum below (1251+746+134+25 = 2156) lands within
// 1 token, which is what makes the component-wise model trustworthy.
const MEASURED_EXPECTED_TURN_INPUT = 2155;   // [P]
const MEASURED_EXPECTED_TURN_INPUT_OAI = 2125; // [P]

// ── Operation builders ──────────────────────────────────────────────────────

const op = (o) => ({
    requestCount: 1, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    reasoningTokens: 0, embeddingTokens: 0, imageCount: 0, retries: 0, fallbackCalls: 0,
    ...o,
});

/** Full conversational LLM turn through intent-router._callLlm (text path). */
const textTurn = (tier, model = M.LITE) => {
    const shape = {
        efficient: { ground: TOK.GROUND_2P_2RAG, hist: TOK.HIST_4, user: TOK.USER_SHORT, out: TOK.OUT_SHORT },
        expected: { ground: TOK.GROUND_5P_4RAG, hist: TOK.HIST_8, user: TOK.USER_EXPECTED, out: TOK.OUT_TYPICAL },
        heavy: { ground: TOK.GROUND_5P_4RAG, hist: TOK.HIST_10, user: TOK.USER_LONG, out: TOK.OUT_LONG },
    }[tier];
    return op({
        operation: `chat_reply_text_${tier}`,
        model,
        inputTokens: TOK.SYS_TEXT_5FAQ + shape.ground + shape.hist + shape.user,
        outputTokens: shape.out,
        measurementSource: tier === 'expected' ? P : T,
        confidence: tier === 'expected' ? 'high' : 'medium',
        notes: tier === 'expected'
            ? `Cross-checked against a real generateContent call: promptTokenCount=${MEASURED_EXPECTED_TURN_INPUT}`
            : 'Component sum of countTokens measurements on the real assembled payload',
    });
};

/** Stage-2 FAQ-hit branch: system prompt + one small user turn, no history. */
const faqBranchTurn = () => op({
    operation: 'chat_reply_faq_branch',
    model: M.LITE,
    inputTokens: TOK.SYS_TEXT_5FAQ + TOK.FAQ_BRANCH_USER,
    outputTokens: TOK.OUT_SHORT,
    measurementSource: T,
    confidence: 'high',
    notes: 'intent-router.service.js:242 — cheaper than the full path because history and grounding are omitted',
});

/** Phase-1 vision attribute extraction (intent-router._extractProductAttributes). */
const visionExtract = () => op({
    operation: 'vision_extract_attrs',
    model: M.LITE,
    inputTokens: TOK.VISION_EXTRACT_SYS + TOK.IMAGE_GEMINI + TOK.VISION_EXTRACT_TEXT,
    outputTokens: TOK.VISION_EXTRACT_OUT,
    imageCount: 1,
    measurementSource: P,
    confidence: 'high',
    notes: 'Real call measured promptTokenCount=1215 (IMAGE 1064 + TEXT 151). Only imageUrls[0] is analysed.',
});

/** Final LLM turn on the image path — sends EVERY image in the burst. */
const imageTurn = (tier, images = 1) => {
    const shape = {
        efficient: { sys: TOK.SYS_IMAGE_FULLFAQ_12, ground: TOK.GROUND_2P_2RAG, hist: TOK.HIST_4, user: TOK.USER_SHORT, out: TOK.OUT_SHORT },
        expected: { sys: TOK.SYS_IMAGE_FULLFAQ_12, ground: TOK.GROUND_5P_4RAG, hist: TOK.HIST_8, user: TOK.USER_EXPECTED, out: TOK.OUT_TYPICAL },
        heavy: { sys: TOK.SYS_IMAGE_FULLFAQ_50, ground: TOK.GROUND_5P_4RAG, hist: TOK.HIST_10, user: TOK.USER_LONG, out: TOK.OUT_LONG },
    }[tier];
    return op({
        operation: `chat_reply_image_${tier}_x${images}`,
        model: M.LITE,
        inputTokens: shape.sys + shape.ground + shape.hist + shape.user + TOK.IMAGE_GEMINI * images,
        outputTokens: shape.out,
        imageCount: images,
        measurementSource: P,
        confidence: 'medium',
        notes: 'Image path uses the FULL FAQ dump (relevantFaqs=null, ai-chatbot.controller.js:267) and attaches every burst image',
    });
};

/** Sentiment guard — only fires on >30-char messages with no keyword hit. */
const sentimentCall = (userTokens = TOK.USER_EXPECTED) => op({
    operation: 'sentiment_classify',
    model: M.LITE,
    inputTokens: TOK.SENTIMENT_SYS + userTokens + 5,
    outputTokens: TOK.SENTIMENT_OUT,
    measurementSource: T,
    confidence: 'medium',
    notes: 'message-worker.js:359. Skipped for <=30 chars or any keyword match (sentiment.service.js:183-196)',
});

/** RAG query embedding — one per text message that reaches _callLlm. */
const queryEmbedding = (model, tokens = TOK.EMB_QUERY_EXPECTED) => op({
    operation: 'embed_rag_query',
    model,
    embeddingTokens: tokens,
    measurementSource: T,
    confidence: 'high',
    notes: 'rag.service.queryData → provider-bound getEmbeddingResult. Local n-gram is dev-only; production uses a READY homogeneous fallback collection when configured.',
});

module.exports = { M, TOK, P, T, S, op, textTurn, faqBranchTurn, visionExtract, imageTurn, sentimentCall, queryEmbedding, MEASURED_EXPECTED_TURN_INPUT, MEASURED_EXPECTED_TURN_INPUT_OAI };
