const axios = require('axios');

/**
 * Pathao Courier Provider Adapter
 * Implements OAuth 2.0 authentication and order management
 */
class PathaoProvider {
    constructor(credentials, isSandbox = false) {
        this.credentials = credentials;
        this.baseUrl = isSandbox 
            ? 'https://courier-api-sandbox.pathao.com'
            : 'https://courier-api.pathao.com';
        this.accessToken = credentials.access_token || null;
        this.refreshToken = credentials.refresh_token || null;
    }

    /**
     * Issue access token from credentials
     */
    async issueToken() {
        try {
            const response = await axios.post(`${this.baseUrl}/aladdin/api/v1/issue-token`, {
                client_id: this.credentials.client_id,
                client_secret: this.credentials.client_secret,
                grant_type: 'password',
                username: this.credentials.username,
                password: this.credentials.password
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;

            return {
                access_token,
                refresh_token,
                expires_in,
                expires_at: new Date(Date.now() + expires_in * 1000)
            };
        } catch (error) {
            throw new Error(`Pathao token issue failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        try {
            const response = await axios.post(`${this.baseUrl}/aladdin/api/v1/issue-token`, {
                client_id: this.credentials.client_id,
                client_secret: this.credentials.client_secret,
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;

            return {
                access_token,
                refresh_token,
                expires_in,
                expires_at: new Date(Date.now() + expires_in * 1000)
            };
        } catch (error) {
            throw new Error(`Pathao token refresh failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Validate credentials by attempting to fetch stores
     */
    async validateCredentials() {
        try {
            // First, issue token
            await this.issueToken();
            
            // Then validate by fetching stores
            const response = await axios.get(`${this.baseUrl}/aladdin/api/v1/stores`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                valid: true,
                stores: response.data.data?.data || [],
                access_token: this.accessToken,
                refresh_token: this.refreshToken
            };
        } catch (error) {
            return {
                valid: false,
                error: error.response?.data?.message || error.message
            };
        }
    }

    /**
     * Create a new order
     */
    async createOrder(orderPayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/aladdin/api/v1/orders`,
                orderPayload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { data } = response.data;
            
            return {
                success: true,
                consignment_id: data.consignment_id,
                merchant_order_id: data.merchant_order_id,
                tracking_code: data.consignment_id,
                order_status: data.order_status,
                delivery_fee: data.delivery_fee
            };
        } catch (error) {
            throw new Error(`Pathao order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Create bulk orders
     */
    async createBulkOrders(ordersArray) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/aladdin/api/v1/orders/bulk`,
                { orders: ordersArray },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: true,
                message: response.data.message,
                code: response.data.code
            };
        } catch (error) {
            throw new Error(`Pathao bulk order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get order status by consignment ID
     */
    async getOrderStatus(consignmentId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/aladdin/api/v1/orders/${consignmentId}/info`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { data } = response.data;
            
            return {
                consignment_id: data.consignment_id,
                merchant_order_id: data.merchant_order_id,
                order_status: data.order_status,
                order_status_slug: data.order_status_slug,
                updated_at: data.updated_at,
                invoice_id: data.invoice_id
            };
        } catch (error) {
            throw new Error(`Pathao status check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Calculate delivery price
     */
    async calculatePrice(pricePayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/aladdin/api/v1/merchant/price-plan`,
                pricePayload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { data } = response.data;
            
            return {
                price: data.price,
                discount: data.discount,
                promo_discount: data.promo_discount,
                cod_percentage: data.cod_percentage,
                additional_charge: data.additional_charge,
                final_price: data.final_price
            };
        } catch (error) {
            throw new Error(`Pathao price calculation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get list of cities
     */
    async getCities() {
        try {
            const response = await axios.get(`${this.baseUrl}/aladdin/api/v1/city-list`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.data?.data || [];
        } catch (error) {
            throw new Error(`Pathao city list fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get zones for a city
     */
    async getZones(cityId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/aladdin/api/v1/cities/${cityId}/zone-list`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data.data?.data || [];
        } catch (error) {
            throw new Error(`Pathao zone list fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get areas for a zone
     */
    async getAreas(zoneId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/aladdin/api/v1/zones/${zoneId}/area-list`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data.data?.data || [];
        } catch (error) {
            throw new Error(`Pathao area list fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Create a new store
     */
    async createStore(storePayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/aladdin/api/v1/stores`,
                storePayload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: true,
                message: response.data.message,
                store_name: response.data.data?.store_name
            };
        } catch (error) {
            throw new Error(`Pathao store creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get merchant stores
     */
    async getStores() {
        try {
            const response = await axios.get(`${this.baseUrl}/aladdin/api/v1/stores`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.data?.data || [];
        } catch (error) {
            throw new Error(`Pathao stores fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }
}

module.exports = PathaoProvider;
