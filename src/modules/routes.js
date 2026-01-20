const express = require('express');
const authRoutes = require('src/modules/auth/auth.routes');
const shopRoutes = require('src/modules/shop/shop.routes');
const categoryRoutes = require('src/modules/category/category.routes');
const productRoutes = require('src/modules/product/product.routes');
const customerRoutes = require('src/modules/customer/customer.routes');
const orderRoutes = require('src/modules/order/order.routes');
const paymentRoutes = require('src/modules/payment/payment.routes');
const ragRoutes = require('src/modules/rag/rag.routes');

const router = express.Router();

// Register routes
router.use('/auth', authRoutes);
router.use('/shop', shopRoutes);
router.use('/category', categoryRoutes);
router.use('/product', productRoutes);
router.use('/customer', customerRoutes);
router.use('/order', orderRoutes);
router.use('/payment', paymentRoutes);
router.use('/rag', ragRoutes);

module.exports = router;
