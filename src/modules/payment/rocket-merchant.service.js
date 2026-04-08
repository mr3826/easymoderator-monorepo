/**
 * Rocket Merchant API Service
 * Handles Rocket (Robi Mobile Money) merchant API integration
 * 
 * Reference:
 * - Rocket API: https://api.rocket.com.bd/docs
 * - Sandbox: https://sandbox-api.rocket.com.bd/
 * - Production: https://api.rocket.com.bd/
 * 
 * @file payment/rocket-merchant.service.js
 */

const axios = require('axios');
const crypto = require('crypto');
const { PaymentConfig, Order } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

class RocketMerchantService {
    constructor() {
        this.baseUrl = process.env.ROCKET_ENVIRONMENT === 'production' 
            ? 'https://api.rocket.com.bd/v1'
            : 'https://sandbox-api.rocket.com.bd/v1';
        this.cache = new Map(); // Simple in-memory cache for tokens
        this.logger = createLogger();
    }

    /**
     * Generate Rocket signature for API requests
     * Rocket uses HMAC-SHA256 for request signing
     */
    generateSignature(data, merchantSecretKey) {
        const signatureString = Object.keys(data)
            .sort()
            .map(key => `${key}=${data[key]}`)
            .join('&');
        return crypto
            .createHmac('sha256', merchantSecretKey)
            .update(signatureString)
            .digest('hex');
    }

    /**
     * Get or refresh Rocket OAuth token
     * Tokens are cached for 50 minutes (Rocket tokens expire in 60 minutes)
     */
    async getOAuthToken(shopId) {
        const cacheKey = `rocket_token_${shopId}`;
        const cached = this.cache.get(cacheKey);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.token;
        }

        const config = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'rocket', is_enabled: true }
        });

        if (!config?.credentials) {
            throw new AppError('Rocket merchant configuration not found', 404);
        }

        const { merchant_id, api_key, service_id } = config.credentials;

        try {
            const timestamp = Date.now().toString();
            
            // Generate signature
            const signatureData = {
                merchant_id,
                timestamp,
                service_id
            };
            const signature = this.generateSignature(signatureData, api_key);

            const response = await axios.post(
                `${this.baseUrl}/auth/token`,
                {
                    merchant_id,
                    service_id,
                    timestamp,
                    signature
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            if (!response.data?.access_token) {
                throw new Error('Invalid token response from Rocket');
            }

            const token = response.data.access_token;
            
            // Cache token for 50 minutes
            this.cache.set(cacheKey, {
                token,
                expiresAt: Date.now() + (50 * 60 * 1000)
            });

            this.logger.info('Rocket OAuth token refreshed', { shopId, merchantId: merchant_id });
            return token;

        } catch (error) {
            this.logger.error('Rocket OAuth token failed', { 
                shopId,
                error: error.message,
                response: error.response?.data
            });
            throw new AppError('Failed to authenticate with Rocket', 500);
        }
    }

    /**
     * Create Rocket checkout payment
     * Returns payment URL for customer to complete payment
     * 
     * @param {string} shopId - Shop ID
     * @param {Object} orderData - Order details
     * @returns {Promise<Object>} Payment initialization response
     */
    async createPayment(shopId, orderData) {
        try {
            const token = await this.getOAuthToken(shopId);
            const config = await PaymentConfig.findOne({
                where: { shop_id: shopId, gateway: 'rocket', is_enabled: true }
            });

            const { merchant_id, service_id } = config.credentials;

            const paymentData = {
                merchant_id,
                service_id,
                order_id: orderData.order_number || orderData.order_id,
                amount: parseFloat(orderData.total).toFixed(2),
                currency: 'BDT',
                description: `Order ${orderData.order_number}`,
                customer_phone: orderData.customer_phone,
                customer_name: orderData.customer_name,
                customer_email: orderData.customer_email || '',
                callback_url: `${process.env.BASE_URL}/api/webhooks/rocket/callback`,
                redirect_url: `${process.env.FRONTEND_URL}/payment/success`,
                failure_url: `${process.env.FRONTEND_URL}/payment/failed`,
                timestamp: Date.now().toString()
            };

            // Generate signature
            const signature = this.generateSignature(paymentData, config.credentials.api_key);
            paymentData.signature = signature;

            const response = await axios.post(
                `${this.baseUrl}/checkout/initiate`,
                paymentData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            if (response.data?.success && response.data?.checkout_url) {
                return {
                    success: true,
                    payment_id: response.data.transaction_id || response.data.id,
                    rocket_url: response.data.checkout_url,
                    payment_method: 'Rocket',
                    amount: orderData.total,
                    order_id: orderData.order_number,
                    transaction_id: response.data.transaction_id
                };
            } else {
                throw new Error(`Invalid Rocket response: ${response.data?.message}`);
            }

        } catch (error) {
            this.logger.error('Rocket payment creation failed', {
                shopId,
                orderId: orderData.order_number,
                error: error.message,
                response: error.response?.data
            });
            throw new AppError(`Failed to initialize Rocket payment: ${error.message}`, 500);
        }
    }

    /**
     * Verify Rocket payment status
     * 
     * @param {string} shopId - Shop ID
     * @param {string} transactionId - Rocket transaction ID
     * @returns {Promise<Object>} Payment verification response
     */
    async verifyPayment(shopId, transactionId) {
        try {
            const token = await this.getOAuthToken(shopId);
            const config = await PaymentConfig.findOne({
                where: { shop_id: shopId, gateway: 'rocket', is_enabled: true }
            });

            const verificationData = {
                merchant_id: config.credentials.merchant_id,
                transaction_id: transactionId,
                timestamp: Date.now().toString()
            };

            const signature = this.generateSignature(verificationData, config.credentials.api_key);

            const response = await axios.post(
                `${this.baseUrl}/checkout/verify`,
                {
                    ...verificationData,
                    signature
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            return {
                success: response.data?.status === 'completed',
                status: response.data?.status,
                transaction_id: response.data?.transaction_id,
                amount: response.data?.amount,
                customer_phone: response.data?.customer_phone,
                message: response.data?.message
            };

        } catch (error) {
            this.logger.error('Rocket payment verification failed', {
                shopId,
                transactionId,
                error: error.message,
                response: error.response?.data
            });
            throw new AppError(`Failed to verify Rocket payment: ${error.message}`, 500);
        }
    }

    /**
     * Refund Rocket payment
     * 
     * @param {string} shopId - Shop ID
     * @param {string} transactionId - Original transaction ID
     * @param {number} amount - Refund amount
     * @returns {Promise<Object>} Refund response
     */
    async refundPayment(shopId, transactionId, amount) {
        try {
            const token = await this.getOAuthToken(shopId);
            const config = await PaymentConfig.findOne({
                where: { shop_id: shopId, gateway: 'rocket', is_enabled: true }
            });

            const refundData = {
                merchant_id: config.credentials.merchant_id,
                transaction_id: transactionId,
                amount: parseFloat(amount).toFixed(2),
                timestamp: Date.now().toString()
            };

            const signature = this.generateSignature(refundData, config.credentials.api_key);

            const response = await axios.post(
                `${this.baseUrl}/checkout/refund`,
                {
                    ...refundData,
                    signature
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            return {
                success: response.data?.success,
                refund_id: response.data?.refund_id,
                status: response.data?.status,
                message: response.data?.message
            };

        } catch (error) {
            this.logger.error('Rocket payment refund failed', {
                shopId,
                transactionId,
                amount,
                error: error.message,
                response: error.response?.data
            });
            throw new AppError(`Failed to refund Rocket payment: ${error.message}`, 500);
        }
    }

    /**
     * Test Rocket merchant connection
     * Used during merchant setup to validate credentials
     * 
     * @param {string} merchantId - Merchant ID
     * @param {string} serviceId - Service ID
     * @param {string} apiKey - API Key
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection(merchantId, serviceId, apiKey) {
        try {
            const timestamp = Date.now().toString();
            
            const testData = {
                merchant_id: merchantId,
                timestamp,
                service_id: serviceId
            };

            const signature = crypto
                .createHmac('sha256', apiKey)
                .update(Object.keys(testData)
                    .sort()
                    .map(key => `${key}=${testData[key]}`)
                    .join('&'))
                .digest('hex');

            const response = await axios.post(
                `${this.baseUrl}/auth/token`,
                {
                    ...testData,
                    signature
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return {
                success: !!response.data?.access_token,
                message: 'Rocket merchant credentials verified successfully',
                merchantId
            };

        } catch (error) {
            this.logger.warn('Rocket connection test failed', {
                merchantId,
                error: error.message
            });
            throw new AppError(`Connection test failed: ${error.message}`, 400);
        }
    }

    /**
     * Invalidate cached token (used when token expires or config changes)
     */
    invalidateToken(shopId) {
        const cacheKey = `rocket_token_${shopId}`;
        this.cache.delete(cacheKey);
        this.logger.info('Rocket token cache invalidated', { shopId });
    }
}

module.exports = new RocketMerchantService();
