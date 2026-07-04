'use strict';

const KnowledgeGap = require('../analytics/knowledge-gap.entity');

const MAX_QUESTION_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 100;

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
    const normalizedQuestion = normalizeText(question).slice(0, MAX_QUESTION_LENGTH);
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
    normalizePlatform,
    normalizeLanguage,
    normalizeSource,
};
