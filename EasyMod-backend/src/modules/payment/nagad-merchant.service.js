/**
 * Nagad Merchant API Service
 * Handles Nagad merchant API integration for merchant accounts
 * Cost-optimized with caching and batch operations
 */

const axios = require('axios');
const crypto = require('crypto');
const { PaymentConfig, Order } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

class NagadMerchantService {
    constructor() {
        this.baseUrl = process.env.NAGAD_ENVIRONMENT === 'production' 
            ? 'https://api.mynagad.com' 
            : 'https://api.sandbox.mynagad.com';
        this.cache = new Map(); // Simple in-memory cache for tokens
        this.logger = createLogger();
    }

    /**
     * Generate Nagad signature for API requests
     */
    generateSignature(data, merchantSecretKey) {
        const sortedKeys = Object.keys(data).sort();
        const signatureString = sortedKeys.map(key => `${key}${data[key]}`).join('');
        return crypto.createHash('sha256').update(signatureString + merchantSecretKey).digest('hex');
    }

    /**
     * Get or refresh Nagad OAuth token
     * Tokens are cached for 50 minutes (Nagad tokens expire in 60 minutes)
     */
    async getOAuthToken(shopId) {
        const cacheKey = `nagad_token_${shopId}`;
        const cached = this.cache.get(cacheKey);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.token;
        }

        const config = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'nagad', is_enabled: true }
        });

        if (!config?.credentials) {
            throw new AppError('Nagad merchant configuration not found', 404);
        }

        const { merchant_id, merchant_number, app_secret } = config.credentials;

        try {
            const timestamp = Date.now().toString();
            const iv = crypto.randomBytes(16).toString('hex');
            const plaintext = JSON.stringify({
                merchantId: merchant_id,
                merchantNumber: merchant_number,
                timestamp: timestamp
            });
            
            // Generate signature
            const signatureData = {
                merchantId: merchant_id,
                merchantNumber: merchant_number,
                timestamp: timestamp
            };
            const signature = this.generateSignature(signatureData, app_secret);

            const response = await axios.post(`${this.baseUrl}/api/token/verify`,
                {
                    merchantId: merchant_id,
                    merchantNumber: merchant_number,
                    timestamp: timestamp,
                    signature: signature
                }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-KM-IP-V4': '127.0.0.1', // Should be server IP in production
                    'X-KM-IP-V6': '::1',
                    'X-KM-CLIENT-TYPE': 'PC_WEB'
                }
            });

            const token = response.data.accessToken;
            
            // Cache token for 50 minutes
            this.cache.set(cacheKey, {
                token,
                expiresAt: Date.now() + (50 * 60 * 1000)
            });

            this.logger.info('Nagad OAuth token refreshed', { shopId });
            return token;

        } catch (error) {
            this.logger.error('Nagad OAuth token failed', { 
                shopId, 
                error: error.message 
            });
            throw new AppError('Failed to authenticate with Nagad', 500);
        }
    }

    /**
     * Create Nagad payment
     * Returns payment URL for customer to complete payment
     */
    async createPayment(shopId, orderData) {
        const token = await this.getOAuthToken(shopId);
        const config = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'nagad', is_enabled: true }
        });

        const { merchant_id, merchant_number, app_secret } = config.credentials;

        const timestamp = Date.now().toString();
        const paymentData = {
            merchantId: merchant_id,
            merchantNumber: merchant_number,
            orderId: orderData.order_number,
            amount: orderData.total.toString(),
            currencyCode: 'BDT',
            merchantCallbackURL: `${process.env.BASE_URL}/api/webhooks/nagad/payment-status`,
            additionalMerchantInfo: {
                order_id: orderData.id,
                customer_name: orderData.customer_name,
                customer_phone: orderData.customer_phone
            },
            timestamp: timestamp
        };

        // Generate signature
        const signature = this.generateSignature(paymentData, app_secret);
        paymentData.signature = signature;

        try {
            const response = await axios.post(`${this.baseUrl}/api/verify/create`,
                paymentData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-KM-IP-V4': '127.0.0.1',
                    'X-KM-IP-V6': '::1',
                    'X-KM-CLIENT-TYPE': 'PC_WEB'
                }
            });

            const { paymentReferenceId, paymentUrl } = response.data;

            // Store payment transaction
            await this.createPaymentTransaction({
                orderId: orderData.id,
                shopId,
                paymentId: paymentReferenceId,
                amount: orderData.total,
                status: 'initiated',
                gateway: 'nagad'
            });

            this.logger.info('Nagad payment created', {
                shopId,
                orderId: orderData.id,
                paymentId: paymentReferenceId,
                amount: orderData.total
            });

            return {
                success: true,
                paymentId: paymentReferenceId,
                paymentUrl,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
            };

        } catch (error) {
            this.logger.error('Nagad payment creation failed', {
                shopId,
                orderId: orderData.id,
                error: error.response?.data || error.message
            });
            throw new AppError('Failed to create Nagad payment', 500);
        }
    }

    /**
     * Verify Nagad payment status
     */
    async verifyPayment(shopId, paymentReferenceId) {
        const token = await this.getOAuthToken(shopId);
        const config = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'nagad', is_enabled: true }
        });

        const { merchant_id, merchant_number, app_secret } = config.credentials;

        const timestamp = Date.now().toString();
        const verificationData = {
            merchantId: merchant_id,
            paymentReferenceId: paymentReferenceId,
            timestamp: timestamp
        };

        // Generate signature
        const signature = this.generateSignature(verificationData, app_secret);
        verificationData.signature = signature;

        try {
            const response = await axios.post(`${this.baseUrl}/api/verify/payment`,
                verificationData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-KM-IP-V4': '127.0.0.1',
                    'X-KM-IP-V6': '::1',
                    'X-KM-CLIENT-TYPE': 'PC_WEB'
                }
            });

            const paymentData = response.data;

            // Update payment transaction
            await this.updatePaymentTransaction(paymentReferenceId, {
                status: paymentData.paymentStatus,
                gatewayResponse: paymentData,
                verifiedAt: paymentData.paymentStatus === 'Success' ? new Date() : null
            });

            // Update order if payment successful
            if (paymentData.paymentStatus === 'Success') {
                await this.updateOrderPaymentStatus(paymentData.orderId, {
                    status: 'paid',
                    paidAt: new Date(),
                    transactionId: paymentData.transactionId,
                    paymentMethod: 'nagad'
                });
            }

            this.logger.info('Nagad payment verified', {
                shopId,
                paymentId: paymentReferenceId,
                status: paymentData.paymentStatus,
                amount: paymentData.amount
            });

            return {
                success: paymentData.paymentStatus === 'Success',
                status: paymentData.paymentStatus,
                amount: paymentData.amount,
                transactionId: paymentData.transactionId,
                orderId: paymentData.orderId
            };

        } catch (error) {
            this.logger.error('Nagad payment verification failed', {
                shopId,
                paymentId: paymentReferenceId,
                error: error.response?.data || error.message
            });
            throw new AppError('Failed to verify Nagad payment', 500);
        }
    }

    /**
     * Query payment status (for verification and polling)
     */
    async queryPaymentStatus(shopId, paymentReferenceId) {
        const token = await this.getOAuthToken(shopId);
        const config = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'nagad', is_enabled: true }
        });

        const { merchant_id, merchant_number, app_secret } = config.credentials;

        const timestamp = Date.now().toString();
        const queryData = {
            merchantId: merchant_id,
            paymentReferenceId: paymentReferenceId,
            timestamp: timestamp
        };

        // Generate signature
        const signature = this.generateSignature(queryData, app_secret);
        queryData.signature = signature;

        try {
            const response = await axios.post(`${this.baseUrl}/api/verify/query`,
                queryData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-KM-IP-V4': '127.0.0.1',
                    'X-KM-IP-V6': '::1',
                    'X-KM-CLIENT-TYPE': 'PC_WEB'
                }
            });

            const paymentData = response.data;

            // Update payment transaction
            await this.updatePaymentTransaction(paymentReferenceId, {
                status: paymentData.paymentStatus,
                gatewayResponse: paymentData,
                verifiedAt: paymentData.paymentStatus === 'Success' ? new Date() : null
            });

            // Update order if payment successful
            if (paymentData.paymentStatus === 'Success') {
                await this.updateOrderPaymentStatus(paymentData.orderId, {
                    status: 'paid',
                    paidAt: new Date(),
                    transactionId: paymentData.transactionId,
                    paymentMethod: 'nagad'
                });
            }

            return {
                success: true,
                status: paymentData.paymentStatus,
                amount: paymentData.amount,
                transactionId: paymentData.transactionId
            };

        } catch (error) {
            this.logger.error('Nagad payment query failed', {
                shopId,
                paymentId: paymentReferenceId,
                error: error.response?.data || error.message
            });
            throw new AppError('Failed to query Nagad payment status', 500);
        }
    }

    /**
     * Create payment transaction record
     */
    async createPaymentTransaction(data) {
        const { PaymentTransaction } = require('../entities');
        
        await PaymentTransaction.create({
            order_id: data.orderId,
            shop_id: data.shopId,
            payment_method: 'nagad',
            payment_gateway: 'nagad',
            transaction_id: data.paymentId,
            amount: data.amount,
            status: data.status || 'initiated',
            gateway_response: data.gatewayResponse || {},
            created_at: new Date()
        });
    }

    /**
     * Update payment transaction record
     */
    async updatePaymentTransaction(paymentId, updateData) {
        const { PaymentTransaction } = require('../entities');
        
        await PaymentTransaction.update({
            status: updateData.status,
            gateway_response: updateData.gatewayResponse,
            verified_at: updateData.verifiedAt
        }, {
            where: { transaction_id: paymentId }
        });
    }

    /**
     * Update order payment status
     */
    async updateOrderPaymentStatus(orderNumber, updateData) {
        await Order.update({
            payment_status: updateData.status,
            paid_at: updateData.paidAt,
            payment_method: updateData.paymentMethod,
            payment_method_id: updateData.transactionId
        }, {
            where: { order_number: orderNumber }
        });
    }

    /**
     * Validate Nagad configuration
     */
    async validateConfig(credentials) {
        const required = ['merchant_id', 'merchant_number', 'app_secret'];
        const missing = required.filter(key => !credentials[key]);
        
        if (missing.length > 0) {
            throw new AppError(`Missing Nagad credentials: ${missing.join(', ')}`, 400);
        }

        // Test authentication
        try {
            this.baseUrl = process.env.NAGAD_ENVIRONMENT === 'production' 
                ? 'https://api.mynagad.com' 
                : 'https://api.sandbox.mynagad.com';

            const timestamp = Date.now().toString();
            const testData = {
                merchantId: credentials.merchant_id,
                merchantNumber: credentials.merchant_number,
                timestamp: timestamp
            };
            
            const signature = this.generateSignature(testData, credentials.app_secret);
            testData.signature = signature;

            const response = await axios.post(`${this.baseUrl}/api/token/verify`,
                testData, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-KM-IP-V4': '127.0.0.1',
                    'X-KM-IP-V6': '::1',
                    'X-KM-CLIENT-TYPE': 'PC_WEB'
                },
                timeout: 10000 // 10 second timeout
            });

            if (response.data.accessToken) {
                return { success: true, message: 'Nagad credentials validated successfully' };
            }

        } catch (error) {
            throw new AppError('Nagad authentication failed: ' + error.message, 400);
        }
    }

    /**
     * Clear cached token (for testing or forced refresh)
     */
    clearTokenCache(shopId) {
        const cacheKey = `nagad_token_${shopId}`;
        this.cache.delete(cacheKey);
    }
}

module.exports = new NagadMerchantService();
