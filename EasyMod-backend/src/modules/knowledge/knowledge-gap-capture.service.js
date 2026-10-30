'use strict';

const KnowledgeGap = require('../analytics/knowledge-gap.entity');

const MAX_QUESTION_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 100;

// Pilot+ P+05 hygiene: gap rows are improvement evidence, never contact
// records. Phone numbers (local/+880), long digit runs (TrxIDs/amounts),
// "trxid: X" tokens and emails are masked before storage.
const PII_PATTERNS = [
    /(?:\+?88)?0?1[3-9][\s-]?\d{4}[\s-]?\d{4}/g,
    /\b\d{9,}\b/g,
    /\b(?:trx\s*id|trxid|tran?s?action\s*id)\s*[:#-]?\s*[A-Za-z0-9]+/gi,
    /[\w.+-]+@[\w-]+\.[\w.]+/g,
];

function redactSensitive(value) {
    let text = String(value || '');
    for (const pattern of PII_PATTERNS) text = text.replace(pattern, '[masked]');
    return text;
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePlatform(platform) {
    const value = normalizeText(platform).toLowerCase();
    if (value === 'facebook' || value === 'messenger') return 'messenger';
    if (value === 'instagram') return 'instagram';
    return value || 'unknown';
}

function normalizeLanguage(language) {
    const value = normalizeText(language).toLowerCase();
    if (!value) return 'mixed';
    return value.slice(0, 20);
}

function normalizeSource(source) {
    const value = normalizeText(source).toLowerCase();
    return (value || 'ai_handler').slice(0, MAX_SOURCE_LENGTH);
}

async function recordKnowledgeGap({
    shopId,
    question,
    platform,
    language = 'mixed',
    source = 'ai_handler',
} = {}) {
    const normalizedQuestion = redactSensitive(normalizeText(question)).slice(0, MAX_QUESTION_LENGTH);
    if (!shopId || !normalizedQuestion) {
        return { logged: false, reason: 'missing_required_fields' };
    }

    const row = await KnowledgeGap.create({
        shop_id: shopId,
        question: normalizedQuestion,
        platform: normalizePlatform(platform),
        language: normalizeLanguage(language),
        source: normalizeSource(source),
    });

    return { logged: true, id: row?.id || null };
}

module.exports = {
    recordKnowledgeGap,
    redactSensitive,
    normalizePlatform,
    normalizeLanguage,
    normalizeSource,
};
