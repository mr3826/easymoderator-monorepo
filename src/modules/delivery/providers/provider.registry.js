/**
 * Courier Provider Registry
 *
 * Single source of truth for all supported courier providers.
 * Adding a new provider = adding one entry here. No other files need touching.
 *
 * Each entry must supply:
 *   Provider       — class constructor (receives credentials, isSandbox)
 *   label          — human-readable name for error messages
 *   normalizePayload(orderData, metadata)  — maps internal order → provider API body
 *   normalizeResponse(rawResponse)         — maps provider response → internal fields
 *   statusMap      — provider status string → internal status string
 *   credentialFields — required credential keys (used by docs / future validators)
 */

const PathaoProvider = require('./pathao.provider');
const SteadfastProvider = require('./steadfast.provider');
const RedXProvider = require('./redx.provider');

const COURIER_REGISTRY = {
    pathao: {
        Provider: PathaoProvider,
        label: 'Pathao',
        normalizePayload: (orderData, metadata = {}) => ({
            store_id: metadata.store_id || orderData.store_id,
            merchant_order_id: orderData.order_number,
            recipient_name: orderData.customer_name,
            recipient_phone: orderData.customer_phone,
            recipient_address: orderData.delivery_address,
            delivery_type: orderData.delivery_type || 48, // 48 = Normal, 12 = On Demand
            item_type: orderData.item_type || 2,          // 1 = Document, 2 = Parcel
            special_instruction: orderData.note || '',
            item_quantity: orderData.item_quantity || 1,
            item_weight: orderData.item_weight || 0.5,
            item_description: orderData.item_description || '',
            amount_to_collect: orderData.total || 0
        }),
        normalizeResponse: (response) => ({
            consignment_id: response.consignment_id,
            tracking_code: response.consignment_id,
            status: response.order_status,
            delivery_fee: response.delivery_fee
        }),
        statusMap: {
            'Pending': 'pending',
            'Picked_Up': 'picked_up',
            'In_Transit': 'in_transit',
            'Delivered': 'delivered',
            'Cancelled': 'cancelled',
            'Returned': 'returned',
            'Hold': 'hold'
        },
        credentialFields: ['client_id', 'client_secret', 'username', 'password']
    },

    steadfast: {
        Provider: SteadfastProvider,
        label: 'Steadfast',
        normalizePayload: (orderData, metadata = {}) => ({
            invoice: orderData.order_number,
            recipient_name: orderData.customer_name,
            recipient_phone: orderData.customer_phone,
            recipient_address: orderData.delivery_address,
            cod_amount: orderData.total || 0,
            note: orderData.note || '',
            item_description: orderData.item_description || '',
            total_lot: orderData.item_quantity || 1,
            delivery_type: orderData.delivery_type || 0 // 0 = Home, 1 = Point Delivery
        }),
        normalizeResponse: (response) => ({
            consignment_id: response.consignment_id,
            tracking_code: response.tracking_code,
            status: response.status,
            invoice: response.invoice
        }),
        statusMap: {
            'pending': 'pending',
            'in_review': 'in_review',
            'hold': 'hold',
            'delivered_approval_pending': 'delivered_pending',
            'delivered': 'delivered',
            'partial_delivered': 'partial_delivered',
            'cancelled_approval_pending': 'cancelled_pending',
            'cancelled': 'cancelled',
            'unknown': 'unknown'
        },
        credentialFields: ['api_key', 'secret_key']
    },

    redx: {
        Provider: RedXProvider,
        label: 'RedX',
        normalizePayload: (orderData, metadata = {}) => ({
            customer_name: orderData.customer_name,
            customer_phone: orderData.customer_phone,
            delivery_area: orderData.delivery_address,
            delivery_area_id: metadata.delivery_area_id || null,
            cash_collection_amount: orderData.total || 0,
            parcel_weight: orderData.item_weight || 500, // grams
            merchant_invoice_id: orderData.order_number,
            special_instruction: orderData.note || '',
            value: orderData.item_value || orderData.total || 0
        }),
        normalizeResponse: (response) => ({
            consignment_id: response.tracking_code,
            tracking_code: response.tracking_code,
            status: response.status
        }),
        statusMap: {
            'Initiated':         'pending',
            'Picked Up':         'picked_up',
            'In Transit':        'in_transit',
            'Delivered':         'delivered',
            'Cancelled':         'cancelled',
            'Returned':          'returned',
            'Partially Returned':'partial_returned',
            'Hold':              'hold'
        },
        credentialFields: ['api_key']
    }
};

/** Ordered list of registered provider names — used for Joi .valid() */
const PROVIDER_NAMES = Object.keys(COURIER_REGISTRY);

module.exports = { COURIER_REGISTRY, PROVIDER_NAMES };
