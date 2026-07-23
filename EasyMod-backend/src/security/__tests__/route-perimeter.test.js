'use strict';

const fs = require('fs');
const path = require('path');

function source(relative) {
    return fs.readFileSync(path.resolve(__dirname, '../../..', relative), 'utf8');
}

describe('launch route perimeter contracts', () => {
    test('legacy public AI processing, context, and handoff router is unmounted', () => {
        const routes = source('src/modules/routes.js');
        expect(routes).not.toContain("router.use('/ai-chatbot'");
        expect(routes).not.toContain("require('./conversation/ai-chatbot.routes')");
    });

    test('legacy Bangladesh payment router is unmounted', () => {
        const routes = source('src/modules/routes.js');
        expect(routes).not.toContain("router.use('/payment/bangladesh'");
        expect(routes).not.toContain("require('./payment/bangladesh-payment.routes')");
    });

    test('public payment webhook router cannot approve owner payment actions', () => {
        const webhooks = source('src/modules/webhooks/payment-webhook.routes.js');
        expect(webhooks).not.toContain('owner/payment-confirmation');
        const notifications = source('src/modules/notification/notification.routes.js');
        expect(notifications).toContain("router.use(authenticate)");
        expect(notifications).toContain("'/payment-confirmation/:notificationId/:action'");
        expect(notifications).toContain("role: 'owner'");
    });

    test('SSE rejects header/query overrides and resolves the token shop', () => {
        const controller = source('src/modules/conversation/conversation.controller.js');
        expect(controller).toContain("if (req.headers['x-shop-id'] || req.query.shop_id)");
        expect(controller).toContain('const shopId = req.user?.shopId;');
        expect(controller).not.toContain(
            "const shopId = req.headers['x-shop-id'] || req.query.shop_id || req.user?.shopId",
        );
    });

    test('knowledge-gap writes authenticate, rate-limit, and reject cross-shop input', () => {
        const routes = source('src/modules/analytics/analytics.routes.js');
        expect(routes).toMatch(/'\/knowledge-gap',\s*authenticate,\s*knowledgeGapWriteLimiter/);
        const controller = source('src/modules/analytics/analytics.controller.js');
        expect(controller).toContain('req.body.shop_id !== shop_id');
        expect(controller).toContain("action: 'knowledge_gap_created'");
        expect(controller).not.toContain('req.user?.shopId || req.query.shop_id');
        expect(controller).toContain('await sequelize.transaction');
    });

    test('delivery RAG reads and mutations bind to the authenticated shop', () => {
        const routes = source('src/modules/delivery/delivery-rag.routes.js');
        const controller = source('src/modules/delivery/delivery-rag.controller.js');
        expect(routes).toContain('router.use(authenticate)');
        expect(routes).toContain('Cross-shop delivery access is forbidden');
        expect(routes).toContain('superAdminOnly');
        expect(controller).not.toMatch(/const \{ shop_id[^}]*\} = req\.(body|query|params)/);
        expect(controller).toContain('req.authenticatedShopId');
    });
});
