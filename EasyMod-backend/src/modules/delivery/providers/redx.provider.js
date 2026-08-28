const axios = require('axios');
const DeliveryProviderInterface = require('./delivery-provider.interface');

const REDX_HOSTS = Object.freeze({
    sandbox: 'https://sandbox.redx.com.bd/v1.0.0-beta',
    production: 'https://openapi.redx.com.bd/v1.0.0-beta'
});
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

const requestTimeout = () => {
    const parsed = Number.parseInt(process.env.REDX_REQUEST_TIMEOUT_MS, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const responseBody = (data) => {
    if (!data || typeof data !== 'object') return {};
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
    return data;
};

const responseList = (data, key) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.[key])) return data.data[key];
    return data;
};

const eventTime = (event) => {
    const value = event?.time || event?.timestamp || event?.created_at || event?.updated_at;
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
};

const latestEvent = (events) => {
    if (!Array.isArray(events) || events.length === 0) return null;

    return events.reduce((latest, event) => {
        if (!latest) return event;
        const currentTime = eventTime(event);
        const latestTime = eventTime(latest);
        if (currentTime !== null && latestTime !== null) {
            return currentTime >= latestTime ? event : latest;
        }
        return event;
    }, null);
};

/**
 * RedX Courier Provider Adapter.
 * RedX uses a merchant bearer token in API-ACCESS-TOKEN rather than the
 * Authorization header used by most other courier APIs.
 */
class RedXProvider extends DeliveryProviderInterface {
    constructor(credentials = {}, isSandbox = false) {
        super('redx', credentials || {});
        this.isSandbox = isSandbox === true;
        this.baseUrl = this.isSandbox ? REDX_HOSTS.sandbox : REDX_HOSTS.production;
        this.apiKey = typeof this.credentials.api_key === 'string'
            ? this.credentials.api_key.trim()
            : this.credentials.api_key;
        this.timeout = requestTimeout();
        this.requestTimeout = this.timeout;
    }

    getLabel() {
        return 'RedX';
    }

    getCredentialFields() {
        return ['api_key'];
    }

    getStatusMap() {
        return {
            initiated: 'pending',
            'pickup-pending': 'pending',
            'ready-for-delivery': 'picked_up',
            'delivery-in-progress': 'out_for_delivery',
            'agent-hold': 'hold',
            'agent-returning': 'returning',
            'agent-area-change': 'in_transit',
            delivered: 'delivered',
            returned: 'returned',
            paid: 'paid',
            'partial-delivered': 'partial_delivered',
            'partial-returned': 'partial_returned',
            cancelled: 'cancelled',
            Initiated: 'pending',
            'Picked Up': 'picked_up',
            'In Transit': 'in_transit',
            Delivered: 'delivered',
            Cancelled: 'cancelled',
            Returned: 'returned',
            'Partially Returned': 'partial_returned',
            Hold: 'hold'
        };
    }

    normalizePayload(orderData, metadata = {}) {
        const { COURIER_REGISTRY } = require('./provider.registry');
        return COURIER_REGISTRY.redx.normalizePayload(orderData, metadata);
    }

    normalizeResponse(response) {
        const { COURIER_REGISTRY } = require('./provider.registry');
        return COURIER_REGISTRY.redx.normalizeResponse(response);
    }

    getHeaders() {
        const token = String(this.apiKey || '').trim();
        return {
            'API-ACCESS-TOKEN': /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    requestConfig(params) {
        const config = {
            headers: this.getHeaders(),
            timeout: this.timeout
        };
        if (params && typeof params === 'object' && Object.keys(params).length > 0) {
            config.params = params;
        }
        return config;
    }

    async validateCredentials() {
        if (!hasValue(this.apiKey)) {
            return { valid: false, error: 'RedX API key is required' };
        }

        try {
            const response = await axios.get(`${this.baseUrl}/areas`, this.requestConfig());
            return {
                valid: true,
                areas: responseList(response.data, 'areas')
            };
        } catch (error) {
            const normalized = this.normalizeError(error, 'credential validation', [this.apiKey]);
            return {
                valid: false,
                error: normalized.message
            };
        }
    }

    async getAreas(filters = {}) {
        try {
            const response = await axios.get(`${this.baseUrl}/areas`, this.requestConfig(filters));
            return responseList(response.data, 'areas');
        } catch (error) {
            throw this.normalizeError(error, 'area lookup', [this.apiKey]);
        }
    }

    async listAreas(filters = {}) {
        return this.getAreas(filters);
    }

    async listAreasByPostcode(postcode) {
        return this.getAreas({ postcode });
    }

    async listAreasByDistrict(district) {
        return this.getAreas({ district });
    }

    async createPickupStore(storePayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/pickup/store`,
                storePayload,
                this.requestConfig()
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'pickup store creation', [this.apiKey]);
        }
    }

    async getPickupStores(filters = {}) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/pickup/stores`,
                this.requestConfig(filters)
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'pickup store lookup', [this.apiKey]);
        }
    }

    async listPickupStores(filters = {}) {
        return this.getPickupStores(filters);
    }

    async getPickupStoreInfo(storeId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/pickup/store/info/${encodeURIComponent(storeId)}`,
                this.requestConfig()
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'pickup store detail lookup', [this.apiKey]);
        }
    }

    async getPickupStore(storeId) {
        return this.getPickupStoreInfo(storeId);
    }

    async createOrder(orderPayload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/parcels`,
                orderPayload,
                this.requestConfig()
            );
            const body = responseBody(response.data);
            const parcel = body.parcel && typeof body.parcel === 'object' ? body.parcel : body;
            const trackingId = parcel.tracking_number
                || parcel.tracking_id
                || parcel.tracking_code
                || body.tracking_number
                || body.tracking_id
                || body.tracking_code;

            return {
                success: true,
                consignment_id: trackingId,
                tracking_code: trackingId,
                status: parcel.status || parcel.parcel_status || body.status || body.parcel_status,
                recipient_name: orderPayload?.customer_name,
                recipient_phone: orderPayload?.customer_phone,
                cod_amount: orderPayload?.cash_collection_amount
            };
        } catch (error) {
            throw this.normalizeError(error, 'order creation', [this.apiKey]);
        }
    }

    async getOrderStatus(trackingId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/parcel/track/${encodeURIComponent(trackingId)}`,
                this.requestConfig()
            );
            const rawBody = response.data;
            const body = responseBody(rawBody);
            const tracking = Array.isArray(body.tracking)
                ? body.tracking
                : Array.isArray(body.events)
                    ? body.events
                    : Array.isArray(rawBody?.data) ? rawBody.data : [];
            const latest = latestEvent(tracking);
            const parcel = body.parcel && typeof body.parcel === 'object' ? body.parcel : {};
            const status = parcel.status
                || body.parcel_status
                || body.status
                || latest?.status
                || latest?.parcel_status
                || latest?.order_status
                || latest?.status_slug
                || latest?.state
                || latest?.message_en
                || latest?.message;
            const result = {
                tracking_code: trackingId,
                delivery_status: status
            };
            const updatedAt = latest?.time
                || latest?.timestamp
                || latest?.created_at
                || latest?.updated_at
                || parcel.updated_at
                || body.updated_at;
            if (hasValue(updatedAt)) result.updated_at = updatedAt;
            return result;
        } catch (error) {
            throw this.normalizeError(error, 'status check', [this.apiKey]);
        }
    }

    async getParcelInfo(trackingId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/parcel/track/${encodeURIComponent(trackingId)}`,
                this.requestConfig(),
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'parcel lookup', [this.apiKey]);
        }
    }

    async calculatePrice(payload) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/charge/charge_calculator`,
                this.requestConfig(payload)
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'price calculation', [this.apiKey]);
        }
    }

    async calculateCharge(payload) {
        return this.calculatePrice(payload);
    }

    async getParcels(filters = {}) {
        try {
            const response = await axios.get(`${this.baseUrl}/parcels`, this.requestConfig(filters));
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'parcel lookup', [this.apiKey]);
        }
    }

    async updateParcel(payloadOrTrackingId, propertyName, newValue, reason) {
        const payload = payloadOrTrackingId && typeof payloadOrTrackingId === 'object'
            ? payloadOrTrackingId
            : {
                entity_type: 'parcel-tracking-id',
                entity_id: payloadOrTrackingId,
                update_details: {
                    property_name: propertyName,
                    new_value: newValue,
                    reason
                }
            };

        try {
            const response = await axios.patch(
                `${this.baseUrl}/parcels`,
                payload,
                this.requestConfig()
            );
            return response.data;
        } catch (error) {
            throw this.normalizeError(error, 'parcel update', [this.apiKey]);
        }
    }

    async cancelParcel(trackingId, reason = '') {
        return this.updateParcel(trackingId, 'status', 'cancelled', reason);
    }
}

module.exports = RedXProvider;
