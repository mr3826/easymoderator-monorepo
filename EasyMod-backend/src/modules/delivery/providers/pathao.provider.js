'use strict';

const axios = require('axios');
const DeliveryProviderInterface = require('./delivery-provider.interface');

const PRODUCTION_BASE_URL = 'https://api-hermes.pathao.com';
const SANDBOX_BASE_URL = 'https://courier-api-sandbox.pathao.com';
const TOKEN_PATH = '/aladdin/api/v1/issue-token';
const API_PREFIX = '/aladdin/api/v1';

function responseData(response) {
    return response?.data?.data ?? response?.data ?? {};
}

class PathaoProvider extends DeliveryProviderInterface {
    constructor(credentials = {}, isSandbox = false) {
        super('pathao', credentials || {});
        this.isSandbox = isSandbox === true;
        this.baseUrl = this.isSandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
        this.accessToken = this.credentials.access_token || null;
        this.refreshToken = this.credentials.refresh_token || null;
        this.accessTokenExpiresAt = this.credentials.access_token_expires_at
            || this.credentials.expires_at
            || null;
    }

    getLabel() {
        return 'Pathao';
    }

    getCredentialFields() {
        return ['client_id', 'client_secret', 'username', 'password'];
    }

    getStatusMap() {
        return {
            Pending: 'pending',
            Picked_Up: 'picked_up',
            In_Transit: 'in_transit',
            Delivered: 'delivered',
            Cancelled: 'cancelled',
            Returned: 'returned',
            Hold: 'hold',
        };
    }

    normalizePayload(orderData, metadata = {}) {
        const { COURIER_REGISTRY } = require('./provider.registry');
        return COURIER_REGISTRY.pathao.normalizePayload(orderData, metadata);
    }

    normalizeResponse(response) {
        const { COURIER_REGISTRY } = require('./provider.registry');
        return COURIER_REGISTRY.pathao.normalizeResponse(response);
    }

    getHeaders() {
        return {
            Authorization: this.accessToken ? `Bearer ${this.accessToken}` : '',
            'Content-Type': 'application/json',
        };
    }

    normalizeError(error, operation) {
        const normalized = super.normalizeError(error, operation, [
            this.accessToken,
            this.refreshToken,
            this.credentials.client_secret,
            this.credentials.password,
        ]);
        normalized.code = error?.response?.status === 401 ? 'REAUTH_REQUIRED' : 'PROVIDER_REQUEST_FAILED';
        normalized.provider = 'pathao';
        return normalized;
    }

    async request(method, path, payload, config = {}, retryOnUnauthorized = true) {
        const requestConfig = {
            ...config,
            headers: { ...this.getHeaders(), ...(config.headers || {}) },
        };

        try {
            if (method === 'get') {
                return await axios.get(`${this.baseUrl}${path}`, requestConfig);
            }
            return await axios[method](`${this.baseUrl}${path}`, payload, requestConfig);
        } catch (error) {
            if (retryOnUnauthorized && error?.response?.status === 401 && this.refreshToken) {
                await this.refreshAccessToken();
                return this.request(method, path, payload, config, false);
            }
            throw error;
        }
    }

    validateOrderData(orderData = {}) {
        const rawWeight = orderData.item_weight ?? orderData.weight_kg ?? orderData.weight;
        if (rawWeight === undefined || rawWeight === null || rawWeight === '') return;

        const weight = Number(rawWeight);
        if (!Number.isFinite(weight) || weight < 0.5 || weight > 10) {
            const error = new Error('item_weight must be between 0.5 and 10 kg');
            error.status = 400;
            error.statusCode = 400;
            throw error;
        }
    }

    getCapabilities() {
        return {
            ...super.getCapabilities(),
            min_package_weight_kg: 0.5,
            max_package_weight_kg: 10,
        };
    }

    async issueToken() {
        try {
            const response = await axios.post(`${this.baseUrl}${TOKEN_PATH}`, {
                client_id: this.credentials.client_id,
                client_secret: this.credentials.client_secret,
                grant_type: 'password',
                username: this.credentials.username,
                password: this.credentials.password,
            }, { headers: { 'Content-Type': 'application/json' } });

            const data = responseData(response);
            const expiresIn = Number(data.expires_in) || 0;
            const expiresAt = new Date(Date.now() + expiresIn * 1000);
            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token;
            this.accessTokenExpiresAt = expiresAt.toISOString();
            this.credentials.access_token = this.accessToken;
            this.credentials.refresh_token = this.refreshToken;
            this.credentials.access_token_expires_at = this.accessTokenExpiresAt;

            return {
                access_token: this.accessToken,
                refresh_token: this.refreshToken,
                expires_in: expiresIn,
                expires_at: expiresAt,
                access_token_expires_at: this.accessTokenExpiresAt,
            };
        } catch (error) {
            throw this.normalizeError(error, 'token issue');
        }
    }

    async refreshAccessToken() {
        try {
            const response = await axios.post(`${this.baseUrl}${TOKEN_PATH}`, {
                client_id: this.credentials.client_id,
                client_secret: this.credentials.client_secret,
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken,
            }, { headers: { 'Content-Type': 'application/json' } });

            const data = responseData(response);
            const expiresIn = Number(data.expires_in) || 0;
            const expiresAt = new Date(Date.now() + expiresIn * 1000);
            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token || this.refreshToken;
            this.accessTokenExpiresAt = expiresAt.toISOString();
            this.credentials.access_token = this.accessToken;
            this.credentials.refresh_token = this.refreshToken;
            this.credentials.access_token_expires_at = this.accessTokenExpiresAt;

            return {
                access_token: this.accessToken,
                refresh_token: this.refreshToken,
                expires_in: expiresIn,
                expires_at: expiresAt,
                access_token_expires_at: this.accessTokenExpiresAt,
            };
        } catch (error) {
            throw this.normalizeError(error, 'token refresh');
        }
    }

    async validateCredentials() {
        try {
            const token = await this.issueToken();
            const stores = await this.getStores();
            return {
                valid: true,
                stores,
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                expires_in: token.expires_in,
                access_token_expires_at: token.access_token_expires_at,
            };
        } catch (error) {
            return {
                valid: false,
                error: this.normalizeError(error, 'credential validation').message,
            };
        }
    }

    async createOrder(orderPayload) {
        try {
            this.validateOrderData(orderPayload);
            const response = await this.request('post', `${API_PREFIX}/orders`, orderPayload);
            const data = responseData(response);
            return {
                success: true,
                consignment_id: data.consignment_id,
                merchant_order_id: data.merchant_order_id,
                tracking_code: data.consignment_id,
                order_status: data.order_status,
                delivery_fee: data.delivery_fee,
            };
        } catch (error) {
            throw this.normalizeError(error, 'order creation');
        }
    }

    async createBulkOrders(ordersArray) {
        try {
            for (const order of ordersArray || []) this.validateOrderData(order);
            const response = await this.request('post', `${API_PREFIX}/orders/bulk`, { orders: ordersArray });
            const body = response?.data && typeof response.data === 'object' ? response.data : {};
            const data = responseData(response);
            const accepted = response.status === 202 || body.code === 202 || data.code === 202;
            const resultData = body.data !== undefined
                ? body.data
                : data.data !== undefined ? data.data : data;
            return {
                success: true,
                async: accepted,
                message: body.message ?? data.message,
                code: accepted ? 202 : (body.code ?? data.code ?? response.status),
                data: resultData,
            };
        } catch (error) {
            throw this.normalizeError(error, 'bulk order creation');
        }
    }

    async getOrderStatus(consignmentId) {
        try {
            const response = await this.request('get', `${API_PREFIX}/orders/${encodeURIComponent(consignmentId)}/info`);
            const data = responseData(response);
            return {
                consignment_id: data.consignment_id,
                merchant_order_id: data.merchant_order_id,
                order_status: data.order_status,
                order_status_slug: data.order_status_slug,
                updated_at: data.updated_at,
                invoice_id: data.invoice_id,
            };
        } catch (error) {
            throw this.normalizeError(error, 'status check');
        }
    }

    async calculatePrice(pricePayload) {
        try {
            const response = await this.request('post', `${API_PREFIX}/merchant/price-plan`, pricePayload);
            const data = responseData(response);
            return {
                price: data.price,
                discount: data.discount,
                promo_discount: data.promo_discount,
                cod_percentage: data.cod_percentage,
                additional_charge: data.additional_charge,
                final_price: data.final_price,
            };
        } catch (error) {
            throw this.normalizeError(error, 'price calculation');
        }
    }

    async getCities() {
        try {
            const response = await this.request('get', `${API_PREFIX}/city-list`);
            const data = responseData(response);
            return data?.data || data || [];
        } catch (error) {
            throw this.normalizeError(error, 'city list fetch');
        }
    }

    async getZones(cityId) {
        try {
            const response = await this.request('get', `${API_PREFIX}/cities/${encodeURIComponent(cityId)}/zone-list`);
            const data = responseData(response);
            return data?.data || data || [];
        } catch (error) {
            throw this.normalizeError(error, 'zone list fetch');
        }
    }

    async getAreas(zoneId) {
        try {
            const response = await this.request('get', `${API_PREFIX}/zones/${encodeURIComponent(zoneId)}/area-list`);
            const data = responseData(response);
            return data?.data || data || [];
        } catch (error) {
            throw this.normalizeError(error, 'area list fetch');
        }
    }

    async createStore(storePayload) {
        try {
            const response = await this.request('post', `${API_PREFIX}/stores`, storePayload);
            const data = responseData(response);
            return {
                success: true,
                message: response.data?.message,
                store_id: data.store_id || data.id,
                store_name: data.store_name,
                data,
            };
        } catch (error) {
            throw this.normalizeError(error, 'store creation');
        }
    }

    async getStoreInfo(storeId) {
        if (storeId === undefined || storeId === null || storeId === '') return this.getStores();
        try {
            const response = await this.request('get', `${API_PREFIX}/stores/${encodeURIComponent(storeId)}`);
            return responseData(response);
        } catch (error) {
            throw this.normalizeError(error, 'store detail lookup');
        }
    }

    async getStores() {
        try {
            const response = await this.request('get', `${API_PREFIX}/stores`);
            const data = responseData(response);
            return data?.data || data || [];
        } catch (error) {
            throw this.normalizeError(error, 'stores fetch');
        }
    }

    async createBulkOrder(ordersArray) {
        return this.createBulkOrders(ordersArray);
    }
}

module.exports = PathaoProvider;
