const { validationResult } = require('express-validator');
const KnowledgeGap = require('./knowledge-gap.entity');
const enhancedAnalyticsService = require('./analytics-enhanced.service');
const { recordFunnelEvent, ALLOWED_FUNNEL_EVENTS } = require('./funnel-events.service');

class AnalyticsController {
    static async logFunnelEvent(req, res) {
        try {
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
            });

            res.status(200).json({ success: true, data: { id: row.id } });
        } catch (error) {
            console.error('Log funnel event error:', error);
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

            const { question, shop_id, platform, language = 'mixed' } = req.body;

            const gap = await KnowledgeGap.create({
                shop_id,
                question,
                platform,
                language,
                source: 'ai_handler'
            });

            console.log(`📚 Knowledge gap logged for shop ${shop_id}: "${question}"`);

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
            // When called from the authenticated frontend, use the token's shopId.
            // When called by internal tooling without auth, fall back to query param.
            const shop_id = req.user?.shopId || req.query.shop_id;
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
            const shop_id = req.user?.shopId || req.query.shop_id;
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
            const shop_id = req.user?.shopId || req.query.shop_id;
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
            const shop_id = req.user?.shopId || req.query.shop_id;
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
            const shop_id = req.user?.shopId || req.query.shop_id;
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
