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

const { PartnerApplication, Subscription } = require('../entities');
const { PlanCode, PRICING_TIERS, UNLIMITED } = require('./subscription.plans');
const emailService = require('../../utils/email.service');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('PartnerService');

/**
 * Persist a Partner application and best-effort email the admin.
 * @param {{ businessName: string, phone: string, pageLink: string, shopId?: string }} data
 * @returns {Promise<PartnerApplication>}
 */
const applyForPartner = async ({ businessName, phone, pageLink, shopId = null }) => {
    const application = await PartnerApplication.create({
        shop_id: shopId,
        business_name: businessName,
        phone,
        page_link: pageLink,
        status: 'pending'
    });

    const adminEmail = process.env.ADMIN_EMAIL || 'hello@hexabyte.co';
    emailService.sendEmail({
        to: adminEmail,
        subject: `[EasyModerator] New Partner Application - ${businessName}`,
        text: `New Partner plan application received.\n\nBusiness: ${businessName}\nPhone: ${phone}\nFacebook Page: ${pageLink}\nApplication ID: ${application.id}\n`,
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
    return application;
};

/**
 * Approve a Partner application and switch the target shop to the PARTNER plan.
 * @param {string} applicationId
 * @param {{ reviewerId?: string, shopId?: string }} opts - shopId binds an
 *        application that was submitted without one (public Pricing form).
 * @returns {Promise<{ application: PartnerApplication, subscription: Subscription }>}
 */
const approvePartner = async (applicationId, { reviewerId = 'admin', shopId = null } = {}) => {
    const application = await PartnerApplication.findOne({ where: { id: applicationId } });
    if (!application) throw new AppError(`Partner application ${applicationId} not found`, 404);
    if (application.status === 'approved') {
        throw new AppError('Partner application is already approved', 409);
    }

    const targetShopId = shopId || application.shop_id;
    if (!targetShopId) {
        throw new AppError('No shop linked to this application — pass a shopId to bind it', 400);
    }

    const partnerTier = PRICING_TIERS[PlanCode.PARTNER];

    let subscription = await Subscription.findOne({ where: { shop_id: targetShopId } });
    const partnerFields = {
        plan_code: PlanCode.PARTNER,
        plan_name: partnerTier.name,
        plan_price: 0,
        billing_cycle: 'per_order',
        billing_model: 'per_order',
        per_order_charge_bdt: null, // tiered — see PARTNER_ORDER_TIERS
        status: 'active',
        conversations_limit: UNLIMITED,
        orders_limit: UNLIMITED,
        products_limit: UNLIMITED,
        trial_ends_at: null
    };

    if (subscription) {
        await subscription.update(partnerFields);
    } else {
        const now = new Date();
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        subscription = await Subscription.create({
            shop_id: targetShopId,
            ...partnerFields,
            current_period_start: now,
            current_period_end: nextMonth,
            next_billing_date: nextMonth,
            features: partnerTier.features
        });
    }

    await application.update({
        status: 'approved',
        shop_id: targetShopId,
        reviewed_by: reviewerId,
        reviewed_at: new Date()
    });

    logger.info('Partner application approved', { applicationId, shopId: targetShopId, reviewerId });
    return { application, subscription };
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

module.exports = { applyForPartner, approvePartner, listApplications };
