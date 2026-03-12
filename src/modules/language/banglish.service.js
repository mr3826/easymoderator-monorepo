/**
 * M11 — Banglish Transliteration Service
 *
 * Pipeline:
 *   1. Token-level dictionary lookup (BanglishDictionary table)
 *   2. Rule-based phonetic conversion for unknown tokens
 *   3. LLM-assisted correction when BANGLISH_LLM_ENABLED=true (via llm.service)
 *
 * Banglish uses Latin letters to approximate Bangla phonemes.
 * The rule map below covers the most common patterns used in
 * Bangladeshi e-commerce chat (Daraz, Facebook Commerce etc.).
 */

const { Op } = require('sequelize');
const { BanglishDictionary } = require('../entities');

// ---------------------------------------------------------------------------
// Phoneme map: Banglish multi-char digraphs → Bangla Unicode
// Order matters — longer patterns must come before shorter ones.
// ---------------------------------------------------------------------------
const PHONEME_MAP = [
    // Vowels
    ['aa', 'আ'], ['A', 'আ'], ['i', 'ই'], ['ee', 'ঈ'], ['u', 'উ'],
    ['oo', 'ঊ'], ['e', 'এ'], ['oi', 'ঐ'], ['o', 'ও'], ['ou', 'ঔ'],
    // Consonant clusters (digraphs first)
    ['kh', 'খ'], ['gh', 'ঘ'], ['ch', 'চ'], ['chh', 'ছ'], ['jh', 'ঝ'],
    ['th', 'থ'], ['dh', 'ধ'], ['ph', 'ফ'], ['bh', 'ভ'], ['sh', 'শ'],
    ['ng', 'ং'], ['ny', 'ঞ'], ['nj', 'ঞ'], ['nh', 'ণ'],
    ['rr', 'ড়'], ['Rh', 'ঢ়'],
    // Single consonants
    ['k', 'ক'], ['g', 'গ'], ['c', 'ক'], ['j', 'জ'], ['t', 'ট'],
    ['d', 'ড'], ['n', 'ন'], ['p', 'প'], ['b', 'ব'], ['m', 'ম'],
    ['y', 'য'], ['r', 'র'], ['l', 'ল'], ['w', 'ও'], ['s', 'স'],
    ['h', 'হ'], ['f', 'ফ'], ['v', 'ভ'], ['z', 'জ'], ['q', 'ক'],
    ['x', 'ক্স']
];

/**
 * Pure rule-based conversion of a single Banglish word.
 * Returns the Bangla approximation or the original word if it has
 * non-Latin characters (already Bangla / numeric).
 */
const ruleBasedConvert = (word) => {
    if (!word || !/[a-zA-Z]/.test(word)) return word;

    let result = '';
    let input = word.toLowerCase();

    while (input.length > 0) {
        let matched = false;
        for (const [pattern, bangla] of PHONEME_MAP) {
            if (input.startsWith(pattern.toLowerCase())) {
                result += bangla;
                input = input.slice(pattern.length);
                matched = true;
                break;
            }
        }
        if (!matched) {
            result += input[0];
            input = input.slice(1);
        }
    }

    return result;
};

/**
 * Transliterate a full Banglish sentence to Bangla.
 *
 * @param {string} text  - Input Banglish (Latin-script) text
 * @param {object} [opts]
 * @param {boolean} [opts.useLlm=false]   - Use LLM fallback for low-confidence tokens
 * @param {number}  [opts.minConfidence=0.8] - Dictionary confidence threshold (0–1)
 * @returns {Promise<{ original, transliterated, confidence, method }>}
 */
const transliterate = async (text, opts = {}) => {
    if (!text || typeof text !== 'string') {
        throw new Error('text is required');
    }

    const { useLlm = false, minConfidence = 0.8 } = opts;
    const tokens = text.trim().split(/\s+/);

    // Bulk-fetch dictionary entries
    const lowerTokens = tokens.map((t) => t.toLowerCase().replace(/[^a-z]/g, ''));
    const dictRows = await BanglishDictionary.findAll({
        where: {
            banglish: { [Op.in]: lowerTokens.filter(Boolean) }
        }
    });
    const dictMap = new Map(dictRows.map((r) => [r.banglish, { bangla: r.bangla, confidence: r.confidence / 100 }]));

    const transliteratedTokens = [];
    let totalConf = 0;
    let dictHits = 0;

    for (const token of tokens) {
        const key = token.toLowerCase().replace(/[^a-z]/g, '');
        if (!key) {
            transliteratedTokens.push(token);
            totalConf += 1;
            continue;
        }

        const entry = dictMap.get(key);
        if (entry && entry.confidence >= minConfidence) {
            transliteratedTokens.push(entry.bangla);
            totalConf += entry.confidence;
            dictHits++;
        } else {
            // Rule-based fallback
            transliteratedTokens.push(ruleBasedConvert(token));
            totalConf += 0.6;
        }
    }

    const confidence = tokens.length > 0 ? totalConf / tokens.length : 0;
    const transliterated = transliteratedTokens.join(' ');
    const method = dictHits === tokens.length ? 'dictionary' : dictHits > 0 ? 'hybrid' : 'rule-based';

    // Optional LLM refinement for low-confidence results
    if (useLlm && confidence < 0.75) {
        try {
            const llmService = require('../ai/llm.service');
            const refined = await llmService.transliterateWithLlm(text, transliterated);
            return {
                original: text,
                transliterated: refined,
                confidence: 0.92,
                method: 'llm'
            };
        } catch (_) {
            // LLM unavailable — return rule-based result
        }
    }

    return { original: text, transliterated, confidence, method };
};

/**
 * Add or update a word in the BanglishDictionary (learning feedback).
 */
const learnMapping = async (banglish, bangla, confidence = 95) => {
    const key = banglish.toLowerCase().trim();
    const existing = await BanglishDictionary.findOne({ where: { banglish: key } });
    if (existing) {
        await existing.update({ bangla, confidence });
        return { id: existing.id, updated: true };
    }
    const entry = await BanglishDictionary.create({ banglish: key, bangla, confidence });
    return { id: entry.id, updated: false };
};

module.exports = { transliterate, ruleBasedConvert, learnMapping };
