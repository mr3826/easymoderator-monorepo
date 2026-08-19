const express = require('express');
const authRoutes = require('./auth/auth.routes');
const shopRoutes = require('./shop/shop.routes');
const setupRoutes = require('./setup/setup.routes');
const categoryRoutes = require('./category/category.routes');
const productRoutes = require('./product/product.routes');
const customerRoutes = require('./customer/customer.routes');
const orderRoutes = require('./order/order.routes');
const orderSessionRoutes = require('./order/order-session.routes');
const paymentRoutes = require('./payment/payment.routes');
const paymentMethodsRoutes = require('./payment/payment-methods.routes');
// Phase 5: /api/channel (legacy) removed. Canonical surface only:
const metaChannelRoutes = require('./channel-providers/meta-channel.routes');
const dashboardRoutes = require('./dashboard/dashboard.routes');
const conversationRoutes = require('./conversation/conversation.routes');
const ragRoutes = require('./rag/rag.routes');
const auditRoutes = require('./audit/audit.routes');
const deliveryRoutes = require('./delivery/delivery.routes');
const deliveryRagRoutes = require('./delivery/delivery-rag.routes');
const subscriptionRoutes = require('./subscription/subscription.routes');
const knowledgeRoutes = require('./knowledge/knowledge.routes');
const notificationRoutes = require('./notification/notification.routes');
const analyticsRoutes = require('./analytics/analytics.routes');
const banglishRoutes = require('./language/banglish.routes');
const voiceProcessingRoutes = require('./ai/voice-processing.routes');
const sentimentRoutes = require('./ai/sentiment.routes');
const growthOsRoutes = require('./growth-os/growth-os.routes');

const router = express.Router();

// Register routes
router.use('/public', require('./public/public-stats.routes')); // unauthenticated marketing stats
router.use('/auth', authRoutes);
router.use('/shop', shopRoutes);
router.use('/setup', setupRoutes);
router.use('/category', categoryRoutes);
router.use('/product', productRoutes);
router.use('/customer', customerRoutes);
router.use('/order', orderRoutes);
router.use('/order-session', orderSessionRoutes);
router.use('/payment', paymentRoutes);
router.use('/payment-methods', paymentMethodsRoutes);
router.use('/channels/meta', metaChannelRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/conversation', conversationRoutes);
router.use('/rag', ragRoutes);
router.use('/audit', auditRoutes);
router.use('/shop/delivery', deliveryRoutes);
router.use('/delivery/rag', deliveryRagRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/partner', require('./subscription/partner-apply.routes'));
router.use('/admin/partner', require('./subscription/partner-admin.routes'));
router.use('/knowledge', knowledgeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/rto-shield', require('./rto-shield/rto-shield.routes'));
router.use('/language', banglishRoutes);
router.use('/voice', voiceProcessingRoutes);
router.use('/sentiment', sentimentRoutes);
router.use('/templates', require('./template/response-template.routes'));
router.use('/internal/growth-os', growthOsRoutes);
router.use('/admin/failed-jobs', require('./admin/failed-jobs.routes'));
// Phase 1 — EasyModerator operations admin panel (platform-admin guarded inside the router).
// Mounted AFTER /admin/partner and /admin/failed-jobs so those specific routers win first.
router.use('/admin', require('./admin/admin.routes'));

module.exports = router;
