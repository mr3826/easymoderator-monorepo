const { sequelize } = require('../../utils/database/database-setup');
const { QueryTypes } = require('sequelize');
const KnowledgeGap = require('./knowledge-gap.entity');
const { Message, Conversation } = require('../conversation/conversation.entity');

/**
 * Get top unanswered questions for a shop.
 * Queries KnowledgeGap records (low-confidence messages logged by FAQ handler).
 *
 * @param {string} shopId
 * @param {number} limit - Max results (default 10)
 * @returns {Promise<Array<{ question: string, count: number }>>}
 */
const getTopUnansweredQuestions = async (shopId, limit = 10) => {
    const results = await sequelize.query(
        `SELECT question, COUNT(*) AS count
         FROM knowledge_gaps
         WHERE shop_id = :shopId
         GROUP BY question
         ORDER BY count DESC
         LIMIT :limit`,
        {
            replacements: { shopId, limit: parseInt(limit, 10) || 10 },
            type: QueryTypes.SELECT
        }
    );

    return results.map(r => ({ question: r.question, count: parseInt(r.count, 10) }));
};

/**
 * Get peak message hours for a shop over the past N days.
 * Groups message timestamps by hour-of-day (0-23).
 *
 * @param {string} shopId
 * @param {number} days - Look-back window in days (default 30)
 * @returns {Promise<Array<{ hour: number, count: number }>>}
 */
const getPeakHours = async (shopId, days = 30) => {
    const results = await sequelize.query(
        `SELECT EXTRACT(HOUR FROM m.created_at) AS hour, COUNT(*) AS count
         FROM messages m
         INNER JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = :shopId
           AND m.created_at >= NOW() - INTERVAL ':days days'
         GROUP BY hour
         ORDER BY hour ASC`,
        {
            replacements: { shopId, days: parseInt(days, 10) || 30 },
            type: QueryTypes.SELECT
        }
    );

    // Normalise: ensure all 24 hours present
    const hourMap = {};
    for (const r of results) {
        hourMap[parseInt(r.hour, 10)] = parseInt(r.count, 10);
    }

    return Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourMap[h] || 0 }));
};

/**
 * Get intent breakdown — how many conversations matched each intent.
 *
 * @param {string} shopId
 * @param {number} days - Look-back window in days (default 30)
 * @returns {Promise<Array<{ intent: string, count: number }>>}
 */
const getIntentBreakdown = async (shopId, days = 30) => {
    const results = await sequelize.query(
        `SELECT intent, COUNT(*) AS count
         FROM conversations
         WHERE shop_id = :shopId
           AND intent IS NOT NULL
           AND created_at >= NOW() - INTERVAL ':days days'
         GROUP BY intent
         ORDER BY count DESC`,
        {
            replacements: { shopId, days: parseInt(days, 10) || 30 },
            type: QueryTypes.SELECT
        }
    );

    return results.map(r => ({ intent: r.intent, count: parseInt(r.count, 10) }));
};

/**
 * Get confidence score distribution bucketed into four ranges: 0-25, 25-50, 50-75, 75-100.
 * Uses ai_confidence from messages (set during AI response generation).
 *
 * @param {string} shopId
 * @param {number} days - Look-back window in days (default 30)
 * @returns {Promise<Array<{ range: string, count: number }>>}
 */
const getConfidenceDistribution = async (shopId, days = 30) => {
    const results = await sequelize.query(
        `SELECT
           CASE
             WHEN m.ai_confidence IS NULL THEN 'unknown'
             WHEN m.ai_confidence < 0.25 THEN '0-25'
             WHEN m.ai_confidence < 0.50 THEN '25-50'
             WHEN m.ai_confidence < 0.75 THEN '50-75'
             ELSE '75-100'
           END AS range,
           COUNT(*) AS count
         FROM messages m
         INNER JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = :shopId
           AND m.created_at >= NOW() - INTERVAL ':days days'
         GROUP BY range
         ORDER BY range ASC`,
        {
            replacements: { shopId, days: parseInt(days, 10) || 30 },
            type: QueryTypes.SELECT
        }
    );

    return results.map(r => ({ range: r.range, count: parseInt(r.count, 10) }));
};

module.exports = {
    getTopUnansweredQuestions,
    getPeakHours,
    getIntentBreakdown,
    getConfidenceDistribution
};
