'use strict';

/**
 * Top-Up Service
 *
 * Handles conversation pack top-up purchases via BKash.
 * Flow:
 *   1. initiate()  — create pending transaction, start BKash payment
 *   2. complete()  — verify BKash payment, add conversations to subscription, generate invoice
 *   3. cancel()    — mark failed/cancelled
 */

const { sequelize } = require('../../utils/database/database-setup');
const { Subscription } = require('../entities');
const BangladeshPaymentService = require('../payment/bangladesh-payment.service');
const invoiceService = require('./invoice.service');
const { getTopupPack, TOPUP_PACKS } = require('./subscription.plans');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const crypto = require('crypto');

const logger = createLogger('TopupService');
const bdPayment = new BangladeshPaymentService();

/**
 * List available top-up packs.
 */
const getTopupPacks = () => Object.values(TOPUP_PACKS);

/**
 * Initiate a top-up payment.
 * Creates a topup_transaction record (status=pending) and starts BKash checkout.
 *
 * @param {string} shopId
 * @param {string} packCode  - e.g. 'TOPUP_100'
 * @param {{ phone: string, name: string, callbackUrl: string }} customerInfo
 * @returns {{ topupId, bkashUrl, paymentId, pack }}
 */
const initiateTopup = async (shopId, packCode, { phone, name, callbackUrl }) => {
    const pack = getTopupPack(packCode);
    if (!pack) throw new AppError(`Invalid top-up pack: ${packCode}`, 400);

    if (!phone) throw new AppError('phone is required for BKash payment', 400);

    const topupId = crypto.randomUUID();
    const invoiceNumber = `TU-${new Date().toISOString().substring(0, 7).replace('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Insert pending transaction
    await sequelize.query(
        `INSERT INTO topup_transactions
         (id, shop_id, pack_code, pack_conversations, amount_bdt, status, invoice_number, created_at)
         VALUES (:id, :shopId, :packCode, :packConversations, :amountBdt, 'pending', :invoiceNumber, NOW())`,
        {
            replacements: {
                id: topupId,
                shopId,
                packCode,
                packConversations: pack.conversations,
                amountBdt: pack.priceBdt,
                invoiceNumber
            }
        }
    );

    // Start BKash payment
    const bkashResult = await bdPayment.initializeBkashPayment({
        order_id: topupId,
        amount: pack.priceBdt,
        customer_name: name || 'Shop Owner',
        customer_phone: phone,
        callback_url: callbackUrl,
        shop_id: shopId
    });

    if (!bkashResult.success) {
        await sequelize.query(
            `UPDATE topup_transactions SET status='failed' WHERE id=:id`,
            { replacements: { id: topupId } }
        );
        throw new AppError('BKash payment initiation failed', 502);
    }

    // Store bkash_payment_id
    await sequelize.query(
        `UPDATE topup_transactions SET bkash_payment_id=:paymentId WHERE id=:id`,
        { replacements: { paymentId: bkashResult.payment_id, id: topupId } }
    );

    logger.info('Top-up initiated', { topupId, packCode, shopId, bkashPaymentId: bkashResult.payment_id });

    return {
        topup_id: topupId,
        bkash_url: bkashResult.bkash_url,
        payment_id: bkashResult.payment_id,
        pack,
        invoice_number: invoiceNumber
    };
};

/**
 * Complete a top-up after BKash callback.
 * Verifies payment, credits conversations, generates invoice PDF.
 *
 * @param {string} shopId
 * @param {string} topupId
 * @param {string} bkashPaymentId
 * @returns {{ success, conversations_added, invoice_url }}
 */
const completeTopup = async (shopId, topupId, bkashPaymentId) => {
    const [rows] = await sequelize.query(
        `SELECT * FROM topup_transactions WHERE id=:id AND shop_id=:shopId FOR UPDATE`,
        { replacements: { id: topupId, shopId }, type: sequelize.QueryTypes.SELECT }
    );

    if (!rows) throw new AppError('Top-up transaction not found', 404);
    if (rows.status === 'completed') {
        return { success: true, already_completed: true, invoice_url: rows.invoice_pdf_url };
    }
    if (rows.status === 'failed') throw new AppError('Top-up payment was already marked failed', 400);

    // Verify BKash payment
    const verification = await bdPayment.verifyBkashPayment(bkashPaymentId);

    if (!verification.success || verification.status !== 'completed') {
        await sequelize.query(
            `UPDATE topup_transactions SET status='failed', completed_at=NOW(), bkash_trx_id=:trxId WHERE id=:id`,
            { replacements: { trxId: verification.transaction_id || null, id: topupId } }
        );
        throw new AppError('BKash payment verification failed', 402);
    }

    const trxId = verification.transaction_id;
    const pack = getTopupPack(rows.pack_code);
    const conversationsToAdd = rows.pack_conversations || pack?.conversations || 0;

    // Credit conversations atomically
    await sequelize.query(
        `UPDATE subscriptions SET topup_balance = topup_balance + :add, updated_at=NOW()
         WHERE shop_id=:shopId`,
        { replacements: { add: conversationsToAdd, shopId } }
    );

    // Generate invoice PDF
    let invoiceUrl = null;
    try {
        const sub = await Subscription.findOne({ where: { shop_id: shopId } });
        invoiceUrl = await invoiceService.generateTopupInvoice({
            topupId,
            invoiceNumber: rows.invoice_number,
            shopId,
            packCode: rows.pack_code,
            conversations: conversationsToAdd,
            amountBdt: rows.amount_bdt,
            bkashTrxId: trxId,
            shopName: sub?.shop_name || 'Unknown Shop'
        });
    } catch (invErr) {
        logger.error('Invoice generation failed (non-fatal)', { err: invErr.message });
    }

    // Mark transaction completed
    await sequelize.query(
        `UPDATE topup_transactions
         SET status='completed', bkash_trx_id=:trxId, invoice_pdf_url=:invoiceUrl, completed_at=NOW()
         WHERE id=:id`,
        { replacements: { trxId, invoiceUrl, id: topupId } }
    );

    logger.info('Top-up completed', { topupId, shopId, conversationsToAdd, trxId });

    return { success: true, conversations_added: conversationsToAdd, invoice_url: invoiceUrl };
};

/**
 * Get top-up history for a shop.
 */
const getTopupHistory = async (shopId, limit = 20, offset = 0) => {
    const rows = await sequelize.query(
        `SELECT id, pack_code, pack_conversations, amount_bdt, bkash_trx_id, status,
                invoice_number, invoice_pdf_url, created_at, completed_at
         FROM topup_transactions
         WHERE shop_id=:shopId
         ORDER BY created_at DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: { shopId, limit, offset }, type: sequelize.QueryTypes.SELECT }
    );
    return rows;
};

module.exports = { getTopupPacks, initiateTopup, completeTopup, getTopupHistory };
