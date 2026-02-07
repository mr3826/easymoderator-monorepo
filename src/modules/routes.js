const express = require('express');
const authRoutes = require('src/modules/auth/auth.routes');
const shopRoutes = require('src/modules/shop/shop.routes');
const categoryRoutes = require('src/modules/category/category.routes');
const productRoutes = require('src/modules/product/product.routes');
const customerRoutes = require('src/modules/customer/customer.routes');
const orderRoutes = require('src/modules/order/order.routes');
const paymentRoutes = require('src/modules/payment/payment.routes');
const channelRoutes = require('src/modules/channel/channel.routes');
const dashboardRoutes = require('src/modules/dashboard/dashboard.routes');
const conversationRoutes = require('src/modules/conversation/conversation.routes');
const ragRoutes = require('src/modules/rag/rag.routes');
const auditRoutes = require('src/modules/audit/audit.routes');
const metaRoutes = require('src/modules/integration/meta.routes');
const deliveryRoutes = require('src/modules/delivery/delivery.routes');
const subscriptionRoutes = require('src/modules/subscription/subscription.routes');
const knowledgeRoutes = require('src/modules/knowledge/knowledge.routes');

const router = express.Router();

// Register routes
router.use('/auth', authRoutes);
router.use('/shop', shopRoutes);
router.use('/category', categoryRoutes);
router.use('/product', productRoutes);
router.use('/customer', customerRoutes);
router.use('/order', orderRoutes);
router.use('/payment', paymentRoutes);
router.use('/channel', channelRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/conversation', conversationRoutes);
router.use('/rag', ragRoutes);
router.use('/audit', auditRoutes);
router.use('/integrations/meta', metaRoutes);
router.use('/shop/delivery', deliveryRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/knowledge', knowledgeRoutes);

module.exports = router;
