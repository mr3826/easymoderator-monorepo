const { validationResult } = require('express-validator');
const KnowledgeGap = require('./knowledge-gap.entity');

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

            const { question, shop_id, platform, language = 'mixed' } = req.body;

            const gap = await KnowledgeGap.create({
                shop_id,
                question,
                platform,
                language,
                source: 'n8n_faq_handler'
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
}

module.exports = AnalyticsController;
