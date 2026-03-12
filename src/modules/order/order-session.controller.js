const OrderSessionService = require('./order-session-standalone.service');
const { body, validationResult } = require('express-validator');

class OrderSessionController {
    /**
     * Start a new order session
     */
    static async startOrderSession(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                shop_id,
                customer_id,
                customer_channel_id,
                channel,
                initial_message,
                entities,
                product_info
            } = req.body;

            const result = await OrderSessionService.startOrderSession({
                shop_id,
                customer_id,
                customer_channel_id,
                channel,
                initial_message,
                entities,
                product_info
            });

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Start order session error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to start order session'
            });
        }
    }

    /**
     * Process a step in the order flow
     */
    static async processStep(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { id } = req.params;
            const { answer, raw_message } = req.body;

            const result = await OrderSessionService.processStep(id, answer, raw_message);

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Process step error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to process step'
            });
        }
    }

    /**
     * Get active session for a customer
     */
    static async getActiveSession(req, res) {
        try {
            const { shop_id, customer_id } = req.query;

            if (!shop_id || !customer_id) {
                return res.status(400).json({
                    success: false,
                    error: 'shop_id and customer_id are required'
                });
            }

            const session = await OrderSessionService.getActiveSession(shop_id, customer_id);

            if (!session) {
                return res.json({
                    success: true,
                    session: null
                });
            }

            res.json({
                success: true,
                session: {
                    id: session.id,
                    current_step: session.current_step,
                    step_data: session.step_data,
                    product_info: session.product_info,
                    status: session.status
                }
            });
        } catch (error) {
            console.error('Get active session error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get active session'
            });
        }
    }

    /**
     * Get session state
     */
    static async getSessionState(req, res) {
        try {
            const { id } = req.params;

            const state = await OrderSessionService.getSessionState(id);

            res.json({
                success: true,
                ...state
            });
        } catch (error) {
            console.error('Get session state error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to get session state'
            });
        }
    }

    /**
     * Confirm order
     */
    static async confirmOrder(req, res) {
        try {
            const { id } = req.params;

            // This is essentially the same as processing the final confirmation step
            const result = await OrderSessionService.processStep(id, 'YES');

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Confirm order error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to confirm order'
            });
        }
    }

    /**
     * Cancel session
     */
    static async cancelSession(req, res) {
        try {
            const { id } = req.params;

            const result = await OrderSessionService.cancelSession(id);

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('Cancel session error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to cancel session'
            });
        }
    }
}

module.exports = OrderSessionController;
