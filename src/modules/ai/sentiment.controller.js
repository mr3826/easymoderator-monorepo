/**
 * Sentiment Analysis Controller
 *
 * POST /api/sentiment/analyze
 *   Body: { text: string, conversationId?: string }
 *   Returns: { sentiment, confidence, shouldEscalate, method }
 */

const { analyzeSentiment, shouldAutoEscalate } = require('./sentiment.service');
const { AppError } = require('../../utils/AppError');

/**
 * POST /analyze
 * Analyze sentiment of a customer message.
 */
const analyze = async (req, res, next) => {
    try {
        const { text, conversationId } = req.body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new AppError('text is required and must be a non-empty string', 400);
        }

        const shopId = req.user && req.user.shopId;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const result = await analyzeSentiment(text.trim(), shopId);
        const escalate = shouldAutoEscalate(result.sentiment);

        return res.status(200).json({
            success: true,
            data: {
                sentiment: result.sentiment,
                confidence: result.confidence,
                shouldEscalate: escalate,
                method: result.method,
                ...(conversationId ? { conversationId } : {})
            }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { analyze };
