'use strict';

/**
 * Partner Service
 *
 * Onboarding + activation for the per-delivered-order Partner plan.
 *   applyForPartner()  — persist a pending application + notify admin
 *   approvePartner()   — flip a shop's subscription to PARTNER (per-order billing)
 *   listApplications() — admin listing
 *
 * Charging itself is handled at month-end by invoice-generator.js
 * (calculatePartnerCharge over delivered orders) and collected/suspended by
 * failed-payment-reconciler.js — this service only handles onboarding/activation.
 */

const { PartnerApplication, Subscription, Order } = require('../entities');
const { Op } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const subscriptionService = require('./subscription.service');
const { PlanCode, PRICING_TIERS, UNLIMITED } = require('./subscription.plans');
const emailService = require('../../utils/email.service');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('PartnerService');

const recordFunnelEventSafe = (event, values) => {
    try {
        return require('../analytics/funnel-events.service')
            .recordInternalFunnelEvent({ event, ...values })
            .catch(() => {});
    } catch (_) {
        return Promise.resolve();
    }
};

/**
 * Count delivered orders in the rolling qualification window.
 * The immutable delivered_at stamp is the only timestamp used here; editing an
 * order after delivery must not move it into or out of the window.
 */
const countRecentDeliveredOrders = async (shopId, days = 30) => {
    if (!shopId) return 0;
    const windowDays = Number.isFinite(Number(days)) ? Math.max(0, Number(days)) : 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    return Order.count({
        where: {
            shop_id: shopId,
            order_status: 'delivered',
            delivered_at: { [Op.gte]: since }
        }
    });
};

/**
 * Persist a Partner application and best-effort email the admin.
 * @param {{ businessName: string, phone: string, pageLink: string, shopId?: string }} data
 * @returns {Promise<{application: PartnerApplication, eligibility: object}>}
 */
const applyForPartner = async ({ businessName, phone, pageLink, shopId = null }) => {
    const deliveredOrders30d = await countRecentDeliveredOrders(shopId);
    const eligibility = {
        delivered_orders_30d: deliveredOrders30d,
        minimum_delivered_orders: 300,
        eligible: deliveredOrders30d >= 300
    };

    const application = await PartnerApplication.create({
        shop_id: shopId,
        business_name: businessName,
        phone,
        page_link: pageLink,
        status: 'pending'
    });

    const adminEmail = process.env.ADMIN_EMAIL || 'support@easymod.tech';
    emailService.sendEmail({
        to: adminEmail,
        subject: `[EasyModerator] New Partner Application - ${businessName}`,
         text: `New Partner plan application received.\n\nBusiness: ${businessName}\nPhone: ${phone}\nFacebook Page: ${pageLink}\nDelivered orders (30d): ${deliveredOrders30d}\nApplication ID: ${application.id}\n`,
        html: `<h2>New Partner Plan Application</h2>
               <p><strong>Business:</strong> ${businessName}</p>
               <p><strong>Phone:</strong> ${phone}</p>
               <p><strong>Facebook Page:</strong> <a href="${pageLink}">${pageLink}</a></p>
               <p><strong>Application ID:</strong> ${application.id}</p>
               <p>Approve with: <code>node src/scripts/approve-partner.js ${application.id} &lt;shopId&gt;</code></p>`
    }).catch((err) => logger.warn('Partner application admin email failed (non-fatal)', { err: err.message }));

    logger.info('Partner application received', { applicationId: application.id, businessName, shopId });
    try {
        require('../analytics/crm-leads.service')
            .recordCrmLead({
                source: 'partner_form',
                shopId,
                resourceId: application.id,
                leadSource: 'partner_form',
                facebookPage: pageLink,
                status: 'new',
                nextAction: 'Day 1/3/7/12 founder follow-up sequence',
                activationStage: 'lead_captured',
                metadata: { business_name: businessName },
            })
            .catch(() => {});
    } catch (_) { /* CRM logging must never block the public lead form */ }
    recordFunnelEventSafe('partner_applied', {
        shopId,
        metadata: { delivered_orders_30d: deliveredOrders30d },
        onceKey: `partner_applied:${application.id}`,
    });
    return { application, eligibility };
};

/**
 * Approve a Partner application and switch the target shop to the PARTNER plan.
 * @param {string} applicationId
 * @param {{ reviewerId?: string, shopId?: string }} opts - shopId binds an
 *        application that was submitted without one (public Pricing form).
 * @returns {Promise<{ application: PartnerApplication, subscription: Subscription }>}
 */
const approvePartner = async (applicationId, { reviewerId = 'admin', shopId = null } = {}) => {
    const transaction = await sequelize.transaction();
    try {
        const application = await PartnerApplication.findOne({
            where: { id: applicationId },
            transaction,
            lock: transaction.LOCK?.UPDATE,
        });
        if (!application) throw new AppError(`Partner application ${applicationId} not found`, 404);
        if (application.status === 'approved') {
            throw new AppError('Partner application is already approved', 409);
        }

        const targetShopId = shopId || application.shop_id;
        if (!targetShopId) {
            throw new AppError('No shop linked to this application — pass a shopId to bind it', 400);
        }

        const partnerTier = PRICING_TIERS[PlanCode.PARTNER];
        const now = new Date();
        const nextPeriod = new Date(now);
        nextPeriod.setMonth(nextPeriod.getMonth() + 1);

        let subscription = await Subscription.findOne({
            where: { shop_id: targetShopId },
            transaction,
            lock: transaction.LOCK?.UPDATE,
        });
        if (subscription?.id) {
            await subscriptionService.cancelOpenRecurringInvoices(subscription.id, transaction);
        }
        const partnerFields = {
            plan_code: PlanCode.PARTNER,
            plan_name: partnerTier.name,
            plan_price: 0,
            billing_cycle: 'per_order',
            billing_model: 'per_order',
            per_order_charge_bdt: null, // flat band — see PARTNER_ORDER_TIERS
            status: 'active',
            conversations_limit: UNLIMITED,
            orders_limit: UNLIMITED,
            products_limit: UNLIMITED,
            trial_ends_at: null,
            usage_reset_at: null,
            current_period_start: now,
            current_period_end: nextPeriod,
            next_billing_date: nextPeriod,
            features: partnerTier.features
        };

        if (subscription) {
            await subscription.update(partnerFields, { transaction });
        } else {
            subscription = await Subscription.create({
                shop_id: targetShopId,
                ...partnerFields,
                current_period_start: now,
                features: partnerTier.features
            }, { transaction });
        }

        await application.update({
            status: 'approved',
            shop_id: targetShopId,
            reviewed_by: reviewerId,
            reviewed_at: new Date()
        }, { transaction });
        await transaction.commit();
        await require('../../utils/cache.service').clearForShop(targetShopId).catch(() => {});

        logger.info('Partner application approved', { applicationId, shopId: targetShopId, reviewerId });
        recordFunnelEventSafe('partner_approved', {
            shopId: targetShopId,
            metadata: { application_id: applicationId },
            onceKey: `partner_approved:${applicationId}`,
        });
        return { application, subscription };
    } catch (error) {
        await Promise.resolve(transaction.rollback()).catch(() => {});
        throw error;
    }
};

/**
 * List partner applications (admin), newest first.
 * @param {{ status?: string }} filter
 */
const listApplications = async ({ status } = {}) => {
    const where = {};
    if (status) where.status = status;
    return PartnerApplication.findAll({ where, order: [['created_at', 'DESC']] });
};

module.exports = { applyForPartner, approvePartner, listApplications, countRecentDeliveredOrders };
