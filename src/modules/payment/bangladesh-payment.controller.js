const { body, validationResult } = require('express-validator');
const BangladeshPaymentService = require('./bangladesh-payment.service');
const { createLogger } = require('../../utils/structured-logger');
const logger = createLogger({ module: 'bangladesh-payment' });

class BangladeshPaymentController {
    /**
     * Initialize payment
     */
    static async initializePayment(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                payment_method,
                order_id,
                amount,
                customer_name,
                customer_phone,
                callback_url,
                shop_id
            } = req.body;

            const paymentService = new BangladeshPaymentService();
            
            let result;
            if (payment_method.toLowerCase() === 'bkash') {
                result = await paymentService.initializeBkashPayment({
                    order_id,
                    amount,
                    customer_name,
                    customer_phone,
                    callback_url,
                    shop_id
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Unsupported payment method'
                });
            }

            res.json({
                success: true,
                data: result,
                message: `${payment_method} payment initialized successfully`
            });

        } catch (error) {
            logger.error('Initialize payment error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Verify payment
     */
    static async verifyPayment(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { payment_method, payment_id } = req.body;

            const paymentService = new BangladeshPaymentService();
            const result = await paymentService.getPaymentStatus(payment_method, payment_id);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Verify payment error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Process payment callback (webhook)
     */
    static async processCallback(req, res) {
        try {
            const { payment_method } = req.params;
            const callbackData = req.body;

            const paymentService = new BangladeshPaymentService();
            const result = await paymentService.processPaymentCallback(payment_method, callbackData);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Process callback error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get payment status
     */
    static async getPaymentStatus(req, res) {
        try {
            const { payment_method, payment_id } = req.query;

            if (!payment_method || !payment_id) {
                return res.status(400).json({
                    success: false,
                    error: 'payment_method and payment_id are required'
                });
            }

            const paymentService = new BangladeshPaymentService();
            const result = await paymentService.getPaymentStatus(payment_method, payment_id);

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            logger.error('Get payment status error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Refund payment
     */
    static async refundPayment(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { payment_method, payment_id, amount, reason } = req.body;

            const paymentService = new BangladeshPaymentService();
            const result = await paymentService.refundPayment(payment_method, payment_id, amount, reason);

            res.json({
                success: true,
                data: result,
                message: 'Payment refunded successfully'
            });

        } catch (error) {
            logger.error('Refund payment error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Get supported payment methods
     */
    static async getSupportedPaymentMethods(req, res) {
        try {
            const paymentService = new BangladeshPaymentService();
            const methods = paymentService.getSupportedPaymentMethods();

            res.json({
                success: true,
                data: methods
            });

        } catch (error) {
            logger.error('Get payment methods error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Validate payment configuration
     */
    static async validatePaymentConfig(req, res) {
        try {
            const paymentService = new BangladeshPaymentService();
            const validation = paymentService.validatePaymentConfig();

            res.json({
                success: true,
                data: validation
            });

        } catch (error) {
            logger.error('Validate payment config error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Test payment integration (for development)
     */
    static async testPaymentIntegration(req, res) {
        try {
            const { shop_id } = req.query;

            if (!shop_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id is required'
                });
            }

            const paymentService = new BangladeshPaymentService();
            
            // Test configuration
            const configValidation = paymentService.validatePaymentConfig();
            
            // Test payment methods
            const paymentMethods = paymentService.getSupportedPaymentMethods();

            // Sample payment data
            const testOrder = {
                order_id: `TEST_${Date.now()}`,
                amount: 100,
                customer_name: 'Test Customer',
                customer_phone: '01712345678',
                callback_url: `${req.protocol}://${req.get('host')}/api/payment/bangladesh/callback`,
                shop_id: shop_id
            };

            const testResults = {
                config_validation: configValidation,
                supported_methods: paymentMethods,
                test_order_data: testOrder,
                notes: {
                    bkash_enabled: paymentMethods.find(m => m.method === 'bKash')?.enabled || false,
                    nagad_enabled: paymentMethods.find(m => m.method === 'Nagad')?.enabled || false,
                    cod_enabled: paymentMethods.find(m => m.method === 'COD')?.enabled || false
                }
            };

            res.json({
                success: true,
                data: testResults,
                message: 'Payment integration test completed'
            });

        } catch (error) {
            logger.error('Test payment integration error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Simulate payment (for testing without real payment gateways)
     */
    static async simulatePayment(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                payment_method,
                order_id,
                amount,
                customer_name,
                customer_phone,
                shop_id,
                simulate_status = 'success' // 'success', 'failed', 'pending'
            } = req.body;

            // Simulate payment processing delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = {
                success: simulate_status === 'success',
                payment_id: `SIM_${payment_method.toUpperCase()}_${Date.now()}`,
                transaction_id: `SIM_TXN_${Date.now()}`,
                amount: amount,
                order_id: order_id,
                customer_name: customer_name,
                customer_phone: customer_phone,
                payment_method: payment_method,
                status: simulate_status === 'success' ? 'completed' : simulate_status,
                payment_time: new Date().toISOString(),
                simulated: true,
                message: `This is a simulated ${simulate_status} payment for testing purposes`
            };

            res.json({
                success: true,
                data: result,
                message: `Simulated ${payment_method} payment (${simulate_status})`
            });

        } catch (error) {
            logger.error('Simulate payment error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = BangladeshPaymentController;
