'use strict';

/**
 * Knowledge-gap suggestion sweep (daily). Pilot+ P+05.
 *
 * For each shop flagged knowledge_suggestions, deterministically group the
 * LAST WINDOW_DAYS of unanswered knowledge_gaps into merchant-reviewable
 * suggestions (frequency threshold, normalized keys, evidence cursors).
 * Never generates FAQ content, never auto-publishes, never touches the
 * inbound path. Idempotent: re-running upserts the same live rows.
 *
 * Usage: node src/jobs/job-runner.js gap_suggester [--dry-run]
 */

const { createLogger } = require('../utils/structured-logger');

const logger = createLogger('GapSuggesterJob');
const MAX_SHOPS_PER_RUN = Number(process.env.GAP_SUGGESTER_MAX_SHOPS) > 0
    ? Number(process.env.GAP_SUGGESTER_MAX_SHOPS)
    : 200;

class GapSuggesterJob {
    async execute({ dryRun = false, runDate = new Date() } = {}) {
        const { ShopPilotFeatures } = require('../modules/entities');
        const gaps = require('../modules/knowledge/gap-suggestions.service');
        const shops = await ShopPilotFeatures.findAll({
            where: { knowledge_suggestions: true },
            attributes: ['shop_id'],
            limit: MAX_SHOPS_PER_RUN,
        });
        const results = { shops: shops.length, created: 0, updated: 0, reopened: 0, failed: 0, dryRun };
        if (dryRun) return results;

        const now = runDate instanceof Date ? runDate : new Date(runDate);
        for (const { shop_id: shopId } of shops) {
            try {
                const outcome = await gaps.computeForShop(shopId, { now });
                results.created += outcome.created;
                results.updated += outcome.updated;
                results.reopened += outcome.reopened;
            } catch (error) {
                results.failed += 1;
                logger.error('gap_suggester.shop_failed', { shopId, error: error.message });
            }
        }
        logger.info('gap_suggester.run_complete', results);
        return results;
    }
}

module.exports = GapSuggesterJob;
