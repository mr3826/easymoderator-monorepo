'use strict';

const BaseJob = require('./base-job');
const { Subscription } = require('../modules/entities');
const notificationService = require('../modules/notification/conversation-limit-notifier.service');
const { Op } = require('sequelize');

/**
 * Trial Expiry Job
 *
 * Runs daily. Two responsibilities over `trialing` subscriptions:
 *   1. EXPIRE — `trial_ends_at <= now` → flip status to `trial_expired` and push
 *      a "trial ended" notification. The AI auto-reply path pauses for this
 *      status (see subscription.access.isAiActive); the manual inbox stays.
 *   2. NUDGE  — 3 days and 1 day before expiry → push a "trial ending" reminder
 *      to convert the owner to the ৳999 plan.
 *
 * IDEMPOTENT: BaseJob's per-day execution id + the once-per-day cron make the
 * nudges fire at most once per qualifying day. Expiry is naturally idempotent
 * (a row is only `trialing` once before it flips).
 */
class TrialExpiryJob extends BaseJob {
    constructor() {
        super('trial_expiry');
        // Days-before-expiry on which to send the "trial ending" nudge.
        this.NUDGE_DAYS = [3, 1];
    }

    async run({ dryRun, runDate }) {
        const now = runDate instanceof Date ? runDate : new Date();
        const results = { expired: 0, nudged: 0, scanned: 0 };

        const BATCH_SIZE = 100;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const trialing = await Subscription.findAll({
                where: { status: 'trialing' },
                limit: BATCH_SIZE,
                offset,
                order: [['id', 'ASC']]
            });

            if (trialing.length < BATCH_SIZE) hasMore = false;
            offset += trialing.length;
            results.scanned += trialing.length;

            for (const sub of trialing) {
                try {
                    const endsAt = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;

                    // No trial end recorded → nothing to do (defensive).
                    if (!endsAt || Number.isNaN(endsAt.getTime())) continue;

                    if (endsAt <= now) {
                        results.expired++;
                        if (!dryRun) {
                            await sub.update({ status: 'trial_expired' });
                            await notificationService
                                .sendConvLimitNotification(sub.shop_id, 'TRIAL_EXPIRED', {})
                                .catch(() => {});
                        }
                        this.metrics.recordsSucceeded++;
                        continue;
                    }

                    // Whole days remaining (ceil so 23h-left counts as "1 day").
                    const msPerDay = 24 * 60 * 60 * 1000;
                    const daysLeft = Math.ceil((endsAt - now) / msPerDay);

                    if (this.NUDGE_DAYS.includes(daysLeft)) {
                        results.nudged++;
                        if (!dryRun) {
                            await notificationService
                                .sendConvLimitNotification(sub.shop_id, 'TRIAL_ENDING', { daysLeft })
                                .catch(() => {});
                        }
                        this.metrics.recordsSucceeded++;
                    }
                } catch (err) {
                    this.metrics.recordsFailed++;
                    this.metrics.errors.push(`Shop ${sub.shop_id}: ${err.message}`);
                    this.logger.error(`Trial-expiry failed for shop ${sub.shop_id}`, err);
                }
            }
        }

        this.logger.info('[trial_expiry] complete', results);
        return results;
    }
}

module.exports = TrialExpiryJob;
