'use strict';

/**
 * Sales-opportunity sweep (every 10 minutes).
 *
 * For each shop with the customer_intelligence pilot flag, detect
 * purchase-intent conversations that stopped without an order, convert
 * opportunities whose customer has since ordered, and expire stale ones.
 *
 * Deliberately a sweep, not a webhook hook (ADR-0006): it never touches the
 * inbound path, works for every AI reply mode (including MANUAL), and only
 * flags a conversation after it has gone quiet. Idempotent and safe to run
 * concurrently: each shop is processed under a Postgres advisory lock.
 *
 * Usage: node src/jobs/job-runner.js opportunity_detector [--dry-run]
 */

const { createLogger } = require('../utils/structured-logger');
const metrics = require('../modules/pilot-features/pilot-metrics');

const logger = createLogger('OpportunityDetectorJob');
const MAX_SHOPS_PER_RUN = Number(process.env.OPPORTUNITY_DETECTOR_MAX_SHOPS) > 0
    ? Number(process.env.OPPORTUNITY_DETECTOR_MAX_SHOPS)
    : 200;

class OpportunityDetectorJob {
    async execute({ dryRun = false, runDate = new Date() } = {}) {
        const { ShopPilotFeatures } = require('../modules/entities');
        const opportunityService = require('../modules/customer-intelligence/opportunity.service');
        const shops = await ShopPilotFeatures.findAll({
            where: { customer_intelligence: true },
            attributes: ['shop_id'],
            limit: MAX_SHOPS_PER_RUN,
        });
        const results = { shops: shops.length, created: 0, updated: 0, converted: 0, expired: 0, failed: 0, dryRun };
        if (dryRun) return results;

        const now = runDate instanceof Date ? runDate : new Date(runDate);
        for (const { shop_id: shopId } of shops) {
            try {
                const outcome = await opportunityService.detectForShop(shopId, { now });
                results.created += outcome.created;
                results.updated += outcome.updated;
                results.converted += outcome.converted;
                results.expired += outcome.expired;
            } catch (error) {
                // One shop's failure must not stop the others; the next run retries.
                results.failed += 1;
                metrics.increment('opportunity.detector_shop_failed');
                logger.error('opportunity.detector_shop_failed', { shopId, error: error.message });
            }
        }
        logger.info('opportunity.detector_run_complete', results);
        return results;
    }
}

module.exports = OpportunityDetectorJob;
