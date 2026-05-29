const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const CourierCodCollection = require('./courier-collection.entity');
const ReconciliationDispute = require('./reconciliation-dispute.entity');
const { DeliveryIntegration, Order } = require('../entities');
const deliveryService = require('../delivery/delivery.service');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger();

// Flag a discrepancy if it exceeds ৳100 or 5% of claimed amount
const DISCREPANCY_THRESHOLD_FLAT = 100;
const DISCREPANCY_THRESHOLD_PCT  = 0.05;

class ReconciliationService {
    /**
     * Pull Steadfast payout records for a shop and store them.
     * Called by the weekly job or manually via API.
     * @returns {{ collected: number, disputes: number }}
     */
    static async pullSteadfastPayments(shopId) {
        const integration = await DeliveryIntegration.findOne({
            where: { shop_id: shopId, provider: 'steadfast', is_active: true }
        });
        if (!integration) throw new Error('No active Steadfast integration for this shop');

        const provider = await deliveryService.getProviderInstance(shopId, 'steadfast');
        const payments = await provider.getPayments();

        const paymentList = Array.isArray(payments)
            ? payments
            : (payments.data || payments.payments || []);

        let collected = 0;
        let disputes = 0;

        for (const payment of paymentList) {
            try {
                const result = await ReconciliationService.recordPayment(shopId, 'steadfast', payment);
                collected++;
                if (result.dispute) disputes++;
            } catch (err) {
                logger.warn('Failed to record Steadfast payment', {
                    shopId,
                    paymentId: payment.id,
                    error: err.message
                });
            }
        }

        return { collected, disputes };
    }

    /**
     * Store a single courier payout record and auto-dispute if discrepancy detected.
     */
    static async recordPayment(shopId, provider, rawPayment) {
        const paymentRef  = String(rawPayment.id || rawPayment.payment_id);
        const claimedAmt  = parseFloat(rawPayment.amount || rawPayment.total_amount || 0);
        const paymentDate = rawPayment.date || rawPayment.payment_date || new Date().toISOString().slice(0, 10);
        const consignmentIds = Array.isArray(rawPayment.consignment_ids)
            ? rawPayment.consignment_ids
            : [];

        const [collection, created] = await CourierCodCollection.findOrCreate({
            where: { shop_id: shopId, provider, payment_reference: paymentRef },
            defaults: {
                id: uuidv4(),
                shop_id: shopId,
                provider,
                payment_reference: paymentRef,
                claimed_amount: claimedAmt,
                consignment_count: consignmentIds.length,
                consignment_ids: consignmentIds,
                payment_date: paymentDate,
                raw_payload: JSON.stringify(rawPayment)
            }
        });

        if (!created) return { collection, dispute: null }; // already processed

        // Calculate expected amount from our orders matching these consignment IDs
        const expectedAmt = await ReconciliationService.calculateExpectedAmount(
            shopId, consignmentIds, claimedAmt
        );

        const discrepancy = Math.abs(claimedAmt - expectedAmt);
        const pctDiscrepancy = claimedAmt > 0 ? discrepancy / claimedAmt : 0;

        let dispute = null;
        if (discrepancy > DISCREPANCY_THRESHOLD_FLAT || pctDiscrepancy > DISCREPANCY_THRESHOLD_PCT) {
            dispute = await ReconciliationDispute.create({
                id: uuidv4(),
                shop_id: shopId,
                collection_id: collection.id,
                provider,
                payment_reference: paymentRef,
                claimed_amount: claimedAmt,
                expected_amount: expectedAmt,
                discrepancy_amount: claimedAmt - expectedAmt,
                dispute_status: 'open',
                notes: `Auto-detected: courier claims ৳${claimedAmt}, expected ৳${expectedAmt} (diff: ৳${(claimedAmt - expectedAmt).toFixed(2)})`
            });

            logger.warn('COD discrepancy auto-dispute created', {
                shopId, provider, paymentRef,
                claimed: claimedAmt, expected: expectedAmt, discrepancy
            });
        }

        return { collection, dispute };
    }

    /**
     * Sum the COD amounts from orders matching the given consignment IDs.
     * Falls back to claimed_amount if no orders are found (prevents false positives on first import).
     */
    static async calculateExpectedAmount(shopId, consignmentIds, fallback) {
        if (!consignmentIds.length) return fallback;

        const orders = await Order.findAll({
            where: {
                shop_id: shopId,
                delivery_consignment_id: { [Op.in]: consignmentIds }
            },
            attributes: ['total', 'delivery_fee']
        });

        if (!orders.length) return fallback;

        return orders.reduce((sum, o) => {
            const cod = parseFloat(o.total || 0) - parseFloat(o.delivery_fee || 0);
            return sum + cod;
        }, 0);
    }

    /**
     * List COD collection records for a shop.
     */
    static async listCollections(shopId, { page = 1, limit = 20, provider } = {}) {
        const where = { shop_id: shopId };
        if (provider) where.provider = provider;

        const { count, rows } = await CourierCodCollection.findAndCountAll({
            where,
            order: [['payment_date', 'DESC']],
            limit,
            offset: (page - 1) * limit
        });

        return {
            data: rows,
            pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) }
        };
    }

    /**
     * List disputes for a shop.
     */
    static async listDisputes(shopId, { page = 1, limit = 20, status } = {}) {
        const where = { shop_id: shopId };
        if (status) where.dispute_status = status;

        const { count, rows } = await ReconciliationDispute.findAndCountAll({
            where,
            order: [['created_at', 'DESC']],
            limit,
            offset: (page - 1) * limit
        });

        return {
            data: rows,
            pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) }
        };
    }

    /**
     * Manually create a dispute.
     */
    static async createDispute(shopId, { provider, paymentReference, claimedAmount, expectedAmount, notes }) {
        return ReconciliationDispute.create({
            id: uuidv4(),
            shop_id: shopId,
            provider,
            payment_reference: paymentReference,
            claimed_amount: claimedAmount,
            expected_amount: expectedAmount,
            discrepancy_amount: claimedAmount - expectedAmount,
            dispute_status: 'open',
            notes: notes || null
        });
    }

    /**
     * Update dispute status (under_review, resolved, rejected).
     */
    static async updateDisputeStatus(disputeId, shopId, { status, notes, resolvedBy }) {
        const dispute = await ReconciliationDispute.findOne({
            where: { id: disputeId, shop_id: shopId }
        });
        if (!dispute) throw new Error('Dispute not found');

        const updates = { dispute_status: status };
        if (notes) updates.notes = notes;
        if (['resolved', 'rejected'].includes(status)) {
            updates.resolved_at = new Date();
            updates.resolved_by = resolvedBy || null;
        }

        await dispute.update(updates);
        return dispute;
    }
}

module.exports = ReconciliationService;
