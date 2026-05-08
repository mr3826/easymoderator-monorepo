const crypto = require('crypto');
const axios = require('axios');

class BangladeshPaymentService {
    constructor() {
        // Payment gateway configurations
        this.bkashConfig = {
            baseUrl: process.env.BKASH_BASE_URL || 'https://checkout.sandbox.bka.sh/v1.2.0-beta',
            username: process.env.BKASH_USERNAME,
            password: process.env.BKASH_PASSWORD,
            appKey: process.env.BKASH_APP_KEY,
            appSecret: process.env.BKASH_APP_SECRET,
            isSandbox: process.env.BKASH_SANDBOX === 'true'
        };

        this.nagadConfig = {
            baseUrl: process.env.NAGAD_BASE_URL || 'https://api.mynagad.com/api/v2.0',
            merchantId: process.env.NAGAD_MERCHANT_ID,
            merchantNumber: process.env.NAGAD_MERCHANT_NUMBER,
            publicKey: process.env.NAGAD_PUBLIC_KEY,
            privateKey: process.env.NAGAD_PRIVATE_KEY,
            isSandbox: process.env.NAGAD_SANDBOX === 'true'
        };
    }

    /**
     * Initialize bKash payment
     */
    async initializeBkashPayment(orderData) {
        try {
            const {
                order_id,
                amount,
                customer_name,
                customer_phone,
                callback_url,
                shop_id
            } = orderData;

            // Get bKash token
            const token = await this.getBkashToken();
            
            // Create payment
            const paymentData = {
                mode: '0011',
                payerReference: customer_phone,
                callbackURL: callback_url,
                amount: amount.toString(),
                currency: 'BDT',
                intent: 'sale',
                merchantInvoiceNumber: order_id,
                merchantAssociationInfo: `MI${shop_id}`,
                productType: 'GENERAL',
                productDetails: `Order ${order_id}`,
                customerMsisdn: customer_phone,
                customerName: customer_name
            };

            const response = await axios.post(
                `${this.bkashConfig.baseUrl}/checkout/payment/create`,
                paymentData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': token,
                        'X-APP-Key': this.bkashConfig.appKey
                    }
                }
            );

            if (response.data && response.data.paymentID) {
                return {
                    success: true,
                    payment_id: response.data.paymentID,
                    bkash_url: response.data.bkashURL,
                    payment_method: 'bKash',
                    amount: amount,
                    order_id: order_id
                };
            } else {
                throw new Error('Invalid bKash response');
            }

        } catch (error) {
            console.error('bKash initialization error:', error);
            throw new Error(`Failed to initialize bKash payment: ${error.message}`);
        }
    }

    /**
     * Verify bKash payment
     */
    async verifyBkashPayment(payment_id) {
        try {
            const token = await this.getBkashToken();

            const response = await axios.post(
                `${this.bkashConfig.baseUrl}/checkout/payment/execute`,
                { paymentID: payment_id },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': token,
                        'X-APP-Key': this.bkashConfig.appKey
                    }
                }
            );

            if (response.data && response.data.transactionStatus === 'COMPLETED') {
                return {
                    success: true,
                    transaction_id: response.data.trxID,
                    amount: response.data.amount,
                    currency: response.data.currency,
                    payment_time: response.data.paymentTime,
                    customer_msisdn: response.data.customerMsisdn,
                    merchant_invoice: response.data.merchantInvoiceNumber,
                    status: 'completed'
                };
            } else if (response.data && response.data.transactionStatus === 'INITIATED') {
                return {
                    success: false,
                    status: 'pending',
                    message: 'Payment is still being processed'
                };
            } else {
                return {
                    success: false,
                    status: 'failed',
                    message: response.data?.errorMessage || 'Payment verification failed'
                };
            }

        } catch (error) {
            console.error('bKash verification error:', error);
            throw new Error(`Failed to verify bKash payment: ${error.message}`);
        }
    }

    /**
     * Initialize Nagad payment
     */
    async initializeNagadPayment(orderData) {
        try {
            const {
                order_id,
                amount,
                customer_name,
                customer_phone,
                callback_url,
                shop_id
            } = orderData;

            // Generate random invoice ID
            const invoiceId = `${order_id}_${Date.now()}`;

            // Create payment request
            const paymentData = {
                accountNumber: customer_phone,
                amount: amount,
                initiatorType: 'MERCHANT',
                merchantId: this.nagadConfig.merchantId,
                orderId: order_id,
                productDetails: `Order ${order_id}`,
                ipn: callback_url,
                extraData: {
                    shop_id: shop_id,
                    customer_name: customer_name
                }
            };

            // Sign the request
            const signedData = this.signNagadRequest(paymentData);

            const response = await axios.post(
                `${this.nagadConfig.baseUrl}/checkout/create`,
                signedData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-KM-IP-Authorization': this.generateNagadAuth(),
                        'X-KM-IP-Version': 'v2.0'
                    }
                }
            );

            if (response.data && response.data.paymentUrl) {
                return {
                    success: true,
                    payment_id: invoiceId,
                    nagad_url: response.data.paymentUrl,
                    payment_method: 'Nagad',
                    amount: amount,
                    order_id: order_id
                };
            } else {
                throw new Error('Invalid Nagad response');
            }

        } catch (error) {
            console.error('Nagad initialization error:', error);
            throw new Error(`Failed to initialize Nagad payment: ${error.message}`);
        }
    }

    /**
     * Verify Nagad payment
     */
    async verifyNagadPayment(payment_id) {
        try {
            const response = await axios.get(
                `${this.nagadConfig.baseUrl}/verify/payment/${payment_id}`,
                {
                    headers: {
                        'X-KM-IP-Authorization': this.generateNagadAuth(),
                        'X-KM-IP-Version': 'v2.0'
                    }
                }
            );

            if (response.data && response.data.status === 'Success') {
                return {
                    success: true,
                    transaction_id: response.data.transactionId,
                    amount: response.data.amount,
                    payment_time: response.data.paymentDateTime,
                    customer_number: response.data.accountNumber,
                    order_id: response.data.orderId,
                    status: 'completed'
                };
            } else if (response.data && response.data.status === 'Initiated') {
                return {
                    success: false,
                    status: 'pending',
                    message: 'Payment is still being processed'
                };
            } else {
                return {
                    success: false,
                    status: 'failed',
                    message: response.data?.errorMessage || 'Payment verification failed'
                };
            }

        } catch (error) {
            console.error('Nagad verification error:', error);
            throw new Error(`Failed to verify Nagad payment: ${error.message}`);
        }
    }

    /**
     * Get bKash token
     */
    async getBkashToken() {
        try {
            const authData = {
                app_key: this.bkashConfig.appKey,
                app_secret: this.bkashConfig.appSecret
            };

            const response = await axios.post(
                `${this.bkashConfig.baseUrl}/checkout/token/grant`,
                authData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'username': this.bkashConfig.username,
                        'password': this.bkashConfig.password
                    }
                }
            );

            if (response.data && response.data.id_token) {
                return response.data.id_token;
            } else {
                throw new Error('Failed to get bKash token');
            }

        } catch (error) {
            console.error('bKash token error:', error);
            throw new Error(`Failed to get bKash token: ${error.message}`);
        }
    }

    /**
     * Sign Nagad request
     */
    signNagadRequest(data) {
        const timestamp = Date.now().toString();
        const publicKey = this.nagadConfig.publicKey;
        const privateKey = this.nagadConfig.privateKey;

        // Create signature
        const dataString = JSON.stringify(data);
        const signature = crypto
            .createSign('SHA256')
            .update(dataString)
            .end(privateKey, 'base64');

        return {
            ...data,
            timestamp: timestamp,
            signature: signature,
            merchantId: this.nagadConfig.merchantId
        };
    }

    /**
     * Generate Nagad authorization header
     */
    generateNagadAuth() {
        const timestamp = Date.now().toString();
        const nonce = crypto.randomBytes(16).toString('hex');
        
        const authString = `${timestamp}:${nonce}`;
        const signature = crypto
            .createHmac('sha256', this.nagadConfig.privateKey)
            .update(authString)
            .digest('hex');

        return `Bearer ${signature}`;
    }

    /**
     * Process payment callback (webhook)
     */
    async processPaymentCallback(payment_method, callback_data) {
        try {
            if (payment_method.toLowerCase() === 'bkash') {
                return await this.processBkashCallback(callback_data);
            } else if (payment_method.toLowerCase() === 'nagad') {
                return await this.processNagadCallback(callback_data);
            } else {
                throw new Error(`Unsupported payment method: ${payment_method}`);
            }
        } catch (error) {
            console.error('Payment callback error:', error);
            throw new Error(`Failed to process payment callback: ${error.message}`);
        }
    }

    /**
     * Process bKash callback
     */
    async processBkashCallback(callback_data) {
        const { paymentID, status, trxID, amount, merchantInvoiceNumber } = callback_data;

        if (status === 'success' || status === 'COMPLETED') {
            return {
                success: true,
                payment_id: paymentID,
                transaction_id: trxID,
                amount: amount,
                order_id: merchantInvoiceNumber,
                payment_method: 'bKash',
                status: 'completed'
            };
        } else {
            return {
                success: false,
                payment_id: paymentID,
                order_id: merchantInvoiceNumber,
                payment_method: 'bKash',
                status: status,
                message: `Payment ${status}`
            };
        }
    }

    /**
     * Process Nagad callback
     */
    async processNagadCallback(callback_data) {
        const { paymentRefId, status, transactionId, amount, orderId } = callback_data;

        if (status === 'Success') {
            return {
                success: true,
                payment_id: paymentRefId,
                transaction_id: transactionId,
                amount: amount,
                order_id: orderId,
                payment_method: 'Nagad',
                status: 'completed'
            };
        } else {
            return {
                success: false,
                payment_id: paymentRefId,
                order_id: orderId,
                payment_method: 'Nagad',
                status: status,
                message: `Payment ${status}`
            };
        }
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(payment_method, payment_id) {
        try {
            if (payment_method.toLowerCase() === 'bkash') {
                return await this.verifyBkashPayment(payment_id);
            } else if (payment_method.toLowerCase() === 'nagad') {
                return await this.verifyNagadPayment(payment_id);
            } else {
                throw new Error(`Unsupported payment method: ${payment_method}`);
            }
        } catch (error) {
            console.error('Get payment status error:', error);
            throw new Error(`Failed to get payment status: ${error.message}`);
        }
    }

    /**
     * Refund payment (bKash only for now)
     */
    async refundPayment(payment_method, payment_id, amount, reason) {
        try {
            if (payment_method.toLowerCase() === 'bkash') {
                return await this.refundBkashPayment(payment_id, amount, reason);
            } else {
                throw new Error(`Refund not supported for ${payment_method}`);
            }
        } catch (error) {
            console.error('Refund payment error:', error);
            throw new Error(`Failed to refund payment: ${error.message}`);
        }
    }

    /**
     * Refund bKash payment
     */
    async refundBkashPayment(payment_id, amount, reason) {
        try {
            const token = await this.getBkashToken();

            const refundData = {
                paymentID: payment_id,
                amount: amount.toString(),
                trxID: '', // Will be filled by bKash
                sku: 'order_refund',
                reason: reason || 'Customer requested refund'
            };

            const response = await axios.post(
                `${this.bkashConfig.baseUrl}/checkout/payment/refund`,
                refundData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': token,
                        'X-APP-Key': this.bkashConfig.appKey
                    }
                }
            );

            if (response.data && response.data.refundID) {
                return {
                    success: true,
                    refund_id: response.data.refundID,
                    transaction_id: response.data.trxID,
                    amount: amount,
                    status: 'refunded'
                };
            } else {
                throw new Error('Refund failed');
            }

        } catch (error) {
            console.error('bKash refund error:', error);
            throw new Error(`Failed to refund bKash payment: ${error.message}`);
        }
    }

    /**
     * Get supported payment methods
     */
    getSupportedPaymentMethods() {
        return [
            {
                method: 'bKash',
                display_name: 'bKash',
                icon: '/icons/bkash.png',
                enabled: !!this.bkashConfig.appKey,
                description: 'Pay with bKash mobile wallet'
            },
            {
                method: 'Nagad',
                display_name: 'Nagad',
                icon: '/icons/nagad.png',
                enabled: !!this.nagadConfig.merchantId,
                description: 'Pay with Nagad mobile wallet'
            },
            {
                method: 'COD',
                display_name: 'Cash on Delivery',
                icon: '/icons/cod.png',
                enabled: true,
                description: 'Pay when you receive your order'
            }
        ];
    }

    /**
     * Validate payment configuration
     */
    validatePaymentConfig() {
        const issues = [];

        if (!this.bkashConfig.appKey) {
            issues.push('bKash app key not configured');
        }
        if (!this.bkashConfig.appSecret) {
            issues.push('bKash app secret not configured');
        }
        if (!this.nagadConfig.merchantId) {
            issues.push('Nagad merchant ID not configured');
        }
        if (!this.nagadConfig.privateKey) {
            issues.push('Nagad private key not configured');
        }

        return {
            valid: issues.length === 0,
            issues: issues
        };
    }
}

module.exports = BangladeshPaymentService;
