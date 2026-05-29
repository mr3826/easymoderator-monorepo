const axios = require('axios');

/**
 * RedX Courier Provider Adapter
 * BD-specific courier — Bearer token authentication
 * Docs: https://redx.com.bd/post-office/
 */
class RedXProvider {
    constructor(credentials) {
        this.credentials = credentials;
        this.baseUrl = 'https://openapi.redx.com.bd/v1.0.0-beta';
        this.apiKey = credentials.api_key;
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async validateCredentials() {
        try {
            const response = await axios.get(`${this.baseUrl}/account/balance`, {
                headers: this.getHeaders()
            });
            return { valid: true, balance: response.data?.balance };
        } catch (error) {
            return {
                valid: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    async createOrder(orderPayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/parcel`,
                orderPayload,
                { headers: this.getHeaders() }
            );
            const parcel = response.data;
            return {
                success: true,
                consignment_id: parcel.tracking_id,
                tracking_code: parcel.tracking_id,
                status: parcel.parcel_status,
                recipient_name: orderPayload.customer_name,
                recipient_phone: orderPayload.customer_phone,
                cod_amount: orderPayload.cash_collection_amount
            };
        } catch (error) {
            throw new Error(`RedX order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async getOrderStatus(trackingId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/parcel/track/${trackingId}`,
                { headers: this.getHeaders() }
            );
            return {
                tracking_code: trackingId,
                delivery_status: response.data?.parcel_status
            };
        } catch (error) {
            throw new Error(`RedX status check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async getBalance() {
        try {
            const response = await axios.get(`${this.baseUrl}/account/balance`, {
                headers: this.getHeaders()
            });
            return { current_balance: response.data?.balance };
        } catch (error) {
            throw new Error(`RedX balance check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async calculatePrice(payload) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/parcel/price`,
                { headers: this.getHeaders(), params: payload }
            );
            return response.data;
        } catch (error) {
            return null;
        }
    }
}

module.exports = RedXProvider;
