'use strict';

const crypto = require('crypto');

const faqContent = (faq) => [faq?.category, faq?.template_en, faq?.template_bn]
    .filter(value => value !== null && value !== undefined && String(value).trim())
    .map(value => String(value))
    .join('\n');

const faqContentHash = (faq) => crypto.createHash('sha256')
    .update(faqContent(faq), 'utf8')
    .digest('hex');

const faqSnapshot = (faq) => faq?.id === null || faq?.id === undefined
    ? null
    : { id: String(faq.id), type: 'faq', contentHash: faqContentHash(faq) };

const normalizeKnowledgeId = (id) => String(id || '').replace(/^faq-/i, '');

module.exports = {
    faqContent,
    faqContentHash,
    faqSnapshot,
    normalizeKnowledgeId,
};
