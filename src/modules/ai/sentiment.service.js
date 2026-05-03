/**
 * Sentiment Analysis Service
 *
 * Detects Bengali / Banglish / English sentiment from customer messages and
 * decides whether a conversation should be auto-escalated to a human agent.
 *
 * Sentiment classes: 'positive' | 'neutral' | 'frustrated' | 'angry'
 *
 * Strategy:
 *   1. Fast keyword pre-check — if a strong negative keyword is found we
 *      skip the LLM call and return the matched sentiment immediately.
 *   2. LLM call via llm.service chat() for nuanced classification.
 *   3. Fallback to keyword matching if the LLM call fails.
 */

const shopService = require('../shop/shop.service');
const { chat } = require('./llm.service');

// ---------------------------------------------------------------------------
// Keyword dictionaries (Bengali, Banglish, English)
// ---------------------------------------------------------------------------

const ANGRY_KEYWORDS = [
    // Bengali
    'রাগ', 'রাগী', 'ধোঁকা', 'প্রতারণা', 'বেকুব', 'বাজে', 'ফালতু', 'বাটপার', 'ছেঁচড়া',
    'চোর', 'মিথ্যা', 'মিথ্যুক', 'ক্ষতি', 'লুটেরা',
    // Banglish
    'dhoka', 'batpar', 'chor', 'faltu', 'baje', 'mittha', 'page', 'rag',
    // English
    'cheated', 'fraud', 'scam', 'liar', 'worst', 'terrible', 'pathetic',
    'useless', 'disgusting', 'unacceptable', 'lawsuit', 'sue', 'refund now',
    'money back', 'never again', 'absolutely horrible'
];

const FRUSTRATED_KEYWORDS = [
    // Bengali
    'কোনো কাজের না', 'দেরি', 'আসেনি', 'পাইনি', 'সমস্যা', 'ঝামেলা', 'হয়নি',
    'কেন হয়নি', 'কখন আসবে', 'এখনও আসেনি', 'নিম্নমানের',
    // Banglish
    'deri', 'asheni', 'paini', 'shomossa', 'jhamela', 'hoyni', 'kobe ashbe',
    // English
    'still waiting', 'not received', 'delayed', 'wrong item', 'broken',
    'damaged', 'poor quality', 'disappointing', 'not working', 'bad service',
    'no response', 'ignored', 'fed up', 'frustrated', 'unhappy', 'upset',
    'complained before'
];

const POSITIVE_KEYWORDS = [
    // Bengali
    'ধন্যবাদ', 'অসাধারণ', 'চমৎকার', 'ভালো', 'সুন্দর', 'পছন্দ', 'খুশি',
    // Banglish
    'darun', 'sundor', 'valo', 'khushi', 'onek valo', 'love it',
    // English
    'thank you', 'thanks', 'excellent', 'great', 'amazing', 'love', 'perfect',
    'happy', 'satisfied', 'wonderful', 'awesome', 'fantastic', 'good job'
];

/**
 * Fast keyword-based sentiment classifier.
 *
 * @param {string} text
 * @returns {{ sentiment: string, confidence: number, matchedKeyword: string|null }}
 */
const classifyByKeywords = (text) => {
    const lower = text.toLowerCase();

    for (const keyword of ANGRY_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            return { sentiment: 'angry', confidence: 80, matchedKeyword: keyword };
        }
    }

    for (const keyword of FRUSTRATED_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            return { sentiment: 'frustrated', confidence: 75, matchedKeyword: keyword };
        }
    }

    for (const keyword of POSITIVE_KEYWORDS) {
        if (lower.includes(keyword.toLowerCase())) {
            return { sentiment: 'positive', confidence: 70, matchedKeyword: keyword };
        }
    }

    return { sentiment: 'neutral', confidence: 60, matchedKeyword: null };
};

// ---------------------------------------------------------------------------
// LLM-based classification
// ---------------------------------------------------------------------------

const SENTIMENT_SYSTEM_PROMPT = `You are a sentiment classifier for a Bangladeshi e-commerce customer support platform.
Classify the customer message into exactly one of these four categories: positive, neutral, frustrated, angry.

Definitions:
- positive: happy, satisfied, complimenting the shop
- neutral: asking a question, requesting information, no strong emotion
- frustrated: dissatisfied, waiting too long, received wrong or damaged item, poor quality
- angry: rude, threatening, accusing fraud/scam/cheating, demanding refund aggressively

The message may be in Bengali (Bangla script), Banglish (Bengali written in English letters), English, or a mix.

Respond with ONLY a valid JSON object in this exact format (no extra text):
{"sentiment":"<category>","confidence":<0-100>,"reason":"<one short sentence>"}`;

/**
 * Call the shop's configured LLM to classify sentiment.
 *
 * @param {string} text
 * @param {string} shopId
 * @returns {Promise<{ sentiment: string, confidence: number, reason: string }>}
 */
const classifyByLLM = async (text, shopId) => {
    const messages = [
        { role: 'user', content: `Customer message: ${text}` }
    ];

    // Fetch shop AI settings to respect any shop-level model preferences.
    // If unavailable we proceed with the default LLM chain.
    let modelPreset = 'standard';
    try {
        const aiSettings = await shopService.getShopAiSettings(shopId);
        if (aiSettings && aiSettings.model_preset) {
            modelPreset = aiSettings.model_preset;
        }
    } catch (_) {
        // Non-fatal — proceed with default
    }

    const response = await chat({
        systemPrompt: SENTIMENT_SYSTEM_PROMPT,
        messages,
        maxTokens: 150
    });

    // Extract text content from LLM response
    const rawText = typeof response === 'string'
        ? response
        : (response?.content || response?.text || JSON.stringify(response));

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(`Unexpected LLM response format: ${rawText}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const VALID_SENTIMENTS = ['positive', 'neutral', 'frustrated', 'angry'];
    if (!VALID_SENTIMENTS.includes(parsed.sentiment)) {
        throw new Error(`Invalid sentiment value from LLM: ${parsed.sentiment}`);
    }

    return {
        sentiment: parsed.sentiment,
        confidence: Number(parsed.confidence) || 70,
        reason: parsed.reason || ''
    };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze sentiment of a customer message.
 *
 * Uses keyword pre-check first. If no strong keyword signal, calls the LLM.
 * Falls back to keyword matching if the LLM call fails.
 *
 * @param {string} text    - Raw customer message
 * @param {string} shopId  - Shop ID (used to read AI settings)
 * @returns {Promise<{ sentiment: string, confidence: number, method: 'keyword'|'llm'|'fallback' }>}
 */
const analyzeSentiment = async (text, shopId) => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return { sentiment: 'neutral', confidence: 50, method: 'keyword' };
    }

    // 1. Fast keyword pre-check — skip LLM for any strong signal
    const keywordResult = classifyByKeywords(text);

    // Negative signals: always authoritative
    if (keywordResult.sentiment === 'angry' || keywordResult.sentiment === 'frustrated') {
        return { ...keywordResult, method: 'keyword' };
    }

    // Positive signal: keyword match is reliable enough; skip LLM
    if (keywordResult.sentiment === 'positive') {
        return { ...keywordResult, method: 'keyword' };
    }

    // Very short messages (≤ 30 chars) are almost always neutral greetings or
    // simple queries — no need to spend tokens classifying them.
    if (text.trim().length <= 30) {
        return { sentiment: 'neutral', confidence: 65, method: 'keyword' };
    }

    // 2. LLM-based classification for genuinely ambiguous cases
    try {
        const llmResult = await classifyByLLM(text, shopId);
        return { ...llmResult, method: 'llm' };
    } catch (err) {
        console.warn(`[Sentiment] LLM classification failed, falling back to keywords: ${err.message}`);
    }

    // 3. Keyword fallback
    return { ...keywordResult, method: 'fallback' };
};

/**
 * Determine whether a sentiment level warrants auto-escalation to a human agent.
 *
 * @param {string} sentiment - One of 'positive' | 'neutral' | 'frustrated' | 'angry'
 * @returns {boolean}
 */
const shouldAutoEscalate = (sentiment) => {
    return sentiment === 'frustrated' || sentiment === 'angry';
};

module.exports = { analyzeSentiment, shouldAutoEscalate };
