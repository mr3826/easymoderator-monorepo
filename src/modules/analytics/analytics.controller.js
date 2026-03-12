const { body, validationResult } = require('express-validator');
const { Analytics } = require('./analytics.entity');

class AnalyticsController {
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

            const {
                question,
                shop_id,
                platform,
                language = 'mixed'
            } = req.body;

            // Create analytics record for knowledge gap
            const analyticsRecord = await Analytics.create({
                shop_id,
                event_type: 'knowledge_gap',
                event_data: {
                    question,
                    platform,
                    language,
                    timestamp: new Date().toISOString(),
                    source: 'n8n_faq_handler'
                },
                created_at: new Date()
            });

            console.log(`📚 Knowledge gap logged for shop ${shop_id}: "${question}"`);

            res.json({
                success: true,
                logged: true,
                analytics_id: analyticsRecord.id
            });
        } catch (error) {
            console.error('Log knowledge gap error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to log knowledge gap'
            });
        }
    }

    /**
     * Get knowledge gaps for a shop (for admin dashboard)
     */
    static async getKnowledgeGaps(req, res) {
        try {
            const { shop_id } = req.query;
            const { limit = 50, offset = 0 } = req.query;

            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id is required'
                });
            }

            const gaps = await Analytics.findAll({
                where: {
                    shop_id,
                    event_type: 'knowledge_gap'
                },
                order: [['created_at', 'DESC']],
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            res.json({
                success: true,
                data: gaps.map(gap => ({
                    id: gap.id,
                    question: gap.event_data?.question,
                    platform: gap.event_data?.platform,
                    language: gap.event_data?.language,
                    timestamp: gap.event_data?.timestamp,
                    created_at: gap.created_at
                }))
            });
        } catch (error) {
            console.error('Get knowledge gaps error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get knowledge gaps'
            });
        }
    }
}

module.exports = AnalyticsController;
