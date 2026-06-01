#!/usr/bin/env node
'use strict';

/**
 * Approve a Partner application from the command line.
 *
 * Usage:
 *   node src/scripts/approve-partner.js <applicationId> [shopId]
 *
 * - <applicationId> : the partner_applications.id (emailed to admin on apply)
 * - [shopId]        : required only if the application was submitted from the
 *                     public Pricing form (no shop linked). For in-app
 *                     applications the bound shop_id is used automatically.
 *
 * On success the shop's subscription is switched to the PARTNER plan
 * (per-delivered-order billing). Month-end invoices are then produced by the
 * invoice-generator job and collected/suspended by failed-payment-reconciler.
 */

(async () => {
    const [, , applicationId, shopId] = process.argv;

    if (!applicationId) {
        console.error('Usage: node src/scripts/approve-partner.js <applicationId> [shopId]');
        process.exit(1);
    }

    // Load secrets before config/db, mirroring migrate.js / other scripts.
    try { await require('../config/secrets-loader')(); } catch (_) { /* dev: no secret manager */ }
    const { sequelize } = require('../utils/database/database-setup');
    const partnerService = require('../modules/subscription/partner.service');

    try {
        const { application, subscription } = await partnerService.approvePartner(applicationId, {
            reviewerId: 'cli',
            shopId: shopId || null
        });
        console.log('✅ Partner application approved');
        console.log(`   application: ${application.id} (${application.business_name})`);
        console.log(`   shop:        ${subscription.shop_id}`);
        console.log(`   plan:        ${subscription.plan_code} (${subscription.billing_model})`);
        await sequelize.close();
        process.exit(0);
    } catch (err) {
        console.error(`❌ Approval failed: ${err.message}`);
        try { await sequelize.close(); } catch (_) { /* noop */ }
        process.exit(1);
    }
})();
