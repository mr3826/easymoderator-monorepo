const { validationResult } = require('express-validator');
const KnowledgeGap = require('./knowledge-gap.entity');
const enhancedAnalyticsService = require('./analytics-enhanced.service');
const { recordFunnelEvent, ALLOWED_FUNNEL_EVENTS } = require('./funnel-events.service');
const { AuditLog } = require('../entities');
const { sequelize } = require('../../utils/database/database-setup');

class AnalyticsController {
    static async logFunnelEvent(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid funnel event payload.',
                        details: errors.array({ onlyFirstError: true }).map(({ location, path, msg }) => ({
                            location,
                            path,
                            message: msg,
                        })),
                    },
                });
            }

            const { event, metadata = {} } = req.body || {};
            if (!ALLOWED_FUNNEL_EVENTS.has(event)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_FUNNEL_EVENT', message: 'Unsupported funnel event.' }
                });
            }

            const row = await recordFunnelEvent({
                event,
                userId: req.user?.userId || null,
                shopId: req.user?.shopId || null,
                metadata,
                req,
                onceKey: req.get('idempotency-key') || req.get('x-idempotency-key') || null,
            });

            res.status(200).json({ success: true, data: { id: row.id } });
        } catch (error) {
            console.error('Log funnel event error:', {
                name: error?.name,
                code: error?.code,
                statusCode: error?.statusCode,
            });
            res.status(error.statusCode || 500).json({
                success: false,
                error: { code: 'FUNNEL_EVENT_ERROR', message: 'Failed to log funnel event' }
            });
        }
    }

    /**
     * Log knowledge gaps for FAQ improvement
     */
    static async logKnowledgeGap(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { question, platform, language = 'mixed' } = req.body;
            const shop_id = req.user?.shopId;
            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'No authenticated shop selected',
                });
            }
            if (req.body.shop_id && req.body.shop_id !== shop_id) {
                return res.status(403).json({
                    success: false,
                    error: 'Cross-shop knowledge-gap writes are forbidden',
                });
            }

            let gap;
            await sequelize.transaction(async (transaction) => {
                gap = await KnowledgeGap.create({
                    shop_id,
                    question,
                    platform,
                    language,
                    source: 'ai_handler'
                }, { transaction });
                await AuditLog.create({
                    user_id: req.user.userId,
                    shop_id,
                    action: 'knowledge_gap_created',
                    resource_type: 'knowledge_gap',
                    resource_id: gap.id,
                    metadata: { platform, language },
                }, { transaction });
            });

            res.json({ success: true, logged: true, analytics_id: gap.id });
        } catch (error) {
            console.error('Log knowledge gap error:', error);
            res.status(500).json({ success: false, error: 'Failed to log knowledge gap' });
        }
    }

    /**
     * Get knowledge gaps for a shop
     */
    static async getKnowledgeGaps(req, res) {
        try {
            const shop_id = req.user?.shopId;
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            const offset = parseInt(req.query.offset) || 0;

            if (!shop_id) {
                return res.status(400).json({ success: false, error: 'shop_id is required' });
            }

            const gaps = await KnowledgeGap.findAll({
                where: { shop_id },
                order: [['created_at', 'DESC']],
                limit,
                offset
            });

            res.json({
                success: true,
                data: gaps.map(g => ({
                    id: g.id,
                    question: g.question,
                    platform: g.platform,
                    language: g.language,
                    source: g.source,
                    created_at: g.created_at
                }))
            });
        } catch (error) {
            console.error('Get knowledge gaps error:', error);
            res.status(500).json({ success: false, error: 'Failed to get knowledge gaps' });
        }
    }

    /**
     * GET /api/analytics/top-unanswered
     * Returns the most common unanswered questions for the shop.
     */
    static async getTopUnansweredQuestions(req, res) {
        try {
            const shop_id = req.user?.shopId;
            if (!shop_id) return res.status(400).json({ success: false, error: 'shop_id is required' });

            const limit = Math.min(parseInt(req.query.limit) || 10, 50);
            const data = await enhancedAnalyticsService.getTopUnansweredQuestions(shop_id, limit);
            res.json({ success: true, data });
        } catch (error) {
            console.error('getTopUnansweredQuestions error:', error);
            res.status(500).json({ success: false, error: 'Failed to get unanswered questions' });
        }
    }

    /**
     * GET /api/analytics/peak-hours
     * Returns message volume grouped by hour-of-day over the past N days.
     */
    static async getPeakHours(req, res) {
        try {
            const shop_id = req.user?.shopId;
            if (!shop_id) return res.status(400).json({ success: false, error: 'shop_id is required' });

            const days = Math.min(parseInt(req.query.days) || 30, 365);
            const data = await enhancedAnalyticsService.getPeakHours(shop_id, days);
            res.json({ success: true, data });
        } catch (error) {
            console.error('getPeakHours error:', error);
            res.status(500).json({ success: false, error: 'Failed to get peak hours' });
        }
    }

    /**
     * GET /api/analytics/intent-breakdown
     * Returns conversation count grouped by detected intent.
     */
    static async getIntentBreakdown(req, res) {
        try {
            const shop_id = req.user?.shopId;
            if (!shop_id) return res.status(400).json({ success: false, error: 'shop_id is required' });

            const days = Math.min(parseInt(req.query.days) || 30, 365);
            const data = await enhancedAnalyticsService.getIntentBreakdown(shop_id, days);
            res.json({ success: true, data });
        } catch (error) {
            console.error('getIntentBreakdown error:', error);
            res.status(500).json({ success: false, error: 'Failed to get intent breakdown' });
        }
    }

    /**
     * GET /api/analytics/confidence-distribution
     * Returns AI confidence scores bucketed into 0-25, 25-50, 50-75, 75-100 ranges.
     */
    static async getConfidenceDistribution(req, res) {
        try {
            const shop_id = req.user?.shopId;
            if (!shop_id) return res.status(400).json({ success: false, error: 'shop_id is required' });

            const days = Math.min(parseInt(req.query.days) || 30, 365);
            const data = await enhancedAnalyticsService.getConfidenceDistribution(shop_id, days);
            res.json({ success: true, data });
        } catch (error) {
            console.error('getConfidenceDistribution error:', error);
            res.status(500).json({ success: false, error: 'Failed to get confidence distribution' });
        }
    }
}

module.exports = AnalyticsController;
