const axios = require('axios');

/**
 * Steadfast Courier Provider Adapter
 * Implements API-Key based authentication
 */
class SteadfastProvider {
    constructor(credentials) {
        this.credentials = credentials;
        this.baseUrl = 'https://portal.packzy.com/api/v1';
        this.apiKey = credentials.api_key;
        this.secretKey = credentials.secret_key;
    }

    /**
     * Get request headers
     */
    getHeaders() {
        return {
            'Api-Key': this.apiKey,
            'Secret-Key': this.secretKey,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Validate credentials by checking balance
     */
    async validateCredentials() {
        try {
            const response = await axios.get(`${this.baseUrl}/get_balance`, {
                headers: this.getHeaders()
            });

            if (response.data.status === 200) {
                return {
                    valid: true,
                    balance: response.data.current_balance
                };
            }

            return {
                valid: false,
                error: 'Invalid API credentials'
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
                `${this.baseUrl}/create_order`,
                orderPayload,
                {
                    headers: this.getHeaders()
                }
            );

            if (response.data.status === 200) {
                const { consignment } = response.data;
                
                return {
                    success: true,
                    consignment_id: consignment.consignment_id,
                    invoice: consignment.invoice,
                    tracking_code: consignment.tracking_code,
                    recipient_name: consignment.recipient_name,
                    recipient_phone: consignment.recipient_phone,
                    cod_amount: consignment.cod_amount,
                    status: consignment.status,
                    created_at: consignment.created_at
                };
            }

            throw new Error(response.data.message || 'Order creation failed');
        } catch (error) {
            throw new Error(`Steadfast order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Create bulk orders
     */
    async createBulkOrders(ordersArray) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/create_order/bulk-order`,
                { data: JSON.stringify(ordersArray) },
                {
                    headers: this.getHeaders()
                }
            );

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            throw new Error(`Steadfast bulk order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get order status by consignment ID
     */
    async getOrderStatusByConsignmentId(consignmentId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/status_by_cid/${consignmentId}`,
                {
                    headers: this.getHeaders()
                }
            );

            if (response.data.status === 200) {
                return {
                    consignment_id: consignmentId,
                    delivery_status: response.data.delivery_status
                };
            }

            throw new Error('Status check failed');
        } catch (error) {
            throw new Error(`Steadfast status check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get order status by invoice
     */
    async getOrderStatusByInvoice(invoice) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/status_by_invoice/${invoice}`,
                {
                    headers: this.getHeaders()
                }
            );

            if (response.data.status === 200) {
                return {
                    invoice: invoice,
                    consignment_id: response.data.consignment_id || response.data.consignment?.consignment_id || null,
                    tracking_code: response.data.tracking_code || response.data.consignment?.tracking_code || null,
                    delivery_status: response.data.delivery_status
                };
            }

            throw new Error('Status check failed');
        } catch (error) {
            const wrapped = new Error(`Steadfast status check failed: ${error.response?.data?.message || error.message}`);
            wrapped.status = error.response?.status;
            wrapped.statusCode = error.response?.status;
            throw wrapped;
        }
    }

    /**
     * Get order status by tracking code
     */
    async getOrderStatusByTrackingCode(trackingCode) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/status_by_trackingcode/${trackingCode}`,
                {
                    headers: this.getHeaders()
                }
            );

            if (response.data.status === 200) {
                return {
                    tracking_code: trackingCode,
                    delivery_status: response.data.delivery_status
                };
            }

            throw new Error('Status check failed');
        } catch (error) {
            throw new Error(`Steadfast status check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Generic method to get order status (tries multiple methods)
     */
    async getOrderStatus(reference) {
        // Try consignment ID first if it's numeric
        if (!isNaN(reference)) {
            try {
                return await this.getOrderStatusByConsignmentId(reference);
            } catch (error) {
                // Continue to other methods
            }
        }

        // Try tracking code
        try {
            return await this.getOrderStatusByTrackingCode(reference);
        } catch (error) {
            // Continue to invoice
        }

        // Try invoice
        try {
            return await this.getOrderStatusByInvoice(reference);
        } catch (error) {
            throw new Error(`Could not fetch status for reference: ${reference}`);
        }
    }

    /**
     * Get current balance
     */
    async getBalance() {
        try {
            const response = await axios.get(`${this.baseUrl}/get_balance`, {
                headers: this.getHeaders()
            });

            if (response.data.status === 200) {
                return {
                    current_balance: response.data.current_balance
                };
            }

            throw new Error('Balance check failed');
        } catch (error) {
            throw new Error(`Steadfast balance check failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Create a return request
     */
    async createReturnRequest(payload) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/create_return_request`,
                payload,
                {
                    headers: this.getHeaders()
                }
            );

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            throw new Error(`Steadfast return request failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get return requests
     */
    async getReturnRequests() {
        try {
            const response = await axios.get(`${this.baseUrl}/get_return_requests`, {
                headers: this.getHeaders()
            });

            return response.data;
        } catch (error) {
            throw new Error(`Steadfast return requests fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get single return request
     */
    async getReturnRequest(id) {
        try {
            const response = await axios.get(`${this.baseUrl}/get_return_request/${id}`, {
                headers: this.getHeaders()
            });

            return response.data;
        } catch (error) {
            throw new Error(`Steadfast return request fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get payments
     */
    async getPayments() {
        try {
            const response = await axios.get(`${this.baseUrl}/payments`, {
                headers: this.getHeaders()
            });

            return response.data;
        } catch (error) {
            throw new Error(`Steadfast payments fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get single payment with consignments
     */
    async getPayment(paymentId) {
        try {
            const response = await axios.get(`${this.baseUrl}/payments/${paymentId}`, {
                headers: this.getHeaders()
            });

            return response.data;
        } catch (error) {
            throw new Error(`Steadfast payment fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get police stations
     */
    async getPoliceStations() {
        try {
            const response = await axios.get(`${this.baseUrl}/police_stations`, {
                headers: this.getHeaders()
            });

            return response.data;
        } catch (error) {
            throw new Error(`Steadfast police stations fetch failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Calculate price (Steadfast doesn't have this API, so we return null)
     */
    async calculatePrice(payload) {
        // Steadfast API doesn't provide price calculation endpoint
        // Merchants see pricing after order creation
        return null;
    }
}

module.exports = SteadfastProvider;
