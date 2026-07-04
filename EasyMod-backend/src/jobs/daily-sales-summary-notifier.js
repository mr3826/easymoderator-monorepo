const BaseJob = require('./base-job');
const { Order } = require('../modules/entities');
const { Op, fn, col } = require('sequelize');
const merchantNotificationService = require('../modules/notification/merchant-notification.service');
const { NOTIFICATION_EVENTS } = require('../modules/notification/notification-events');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_TTL_SECONDS = 36 * 60 * 60;

class DailySalesSummaryNotifier extends BaseJob {
    constructor() {
        super('daily_sales_summary_notifier');
    }

    getWindow(runDate) {
        const end = new Date(runDate);
        const start = new Date(end.getTime() - DAY_MS);
        return { start, end };
    }

    async run({ dryRun, runDate }) {
        const { start, end } = this.getWindow(runDate);
        const date = start.toISOString().split('T')[0];

        const rows = await Order.findAll({
            attributes: [
                'shop_id',
                [fn('COUNT', col('id')), 'orderCount'],
                [fn('COALESCE', fn('SUM', col('total')), 0), 'salesTotal']
            ],
            where: {
                created_at: { [Op.gte]: start, [Op.lt]: end }
            },
            group: ['shop_id'],
            raw: true
        });

        this.metrics.recordsProcessed = rows.length;
        const results = {
            date,
            shopsProcessed: rows.length,
            alertsQueued: 0,
            dryRun
        };

        for (const row of rows) {
            try {
                const orderCount = Number(row.orderCount || row.ordercount || 0);
                if (orderCount <= 0) continue;

                if (!dryRun) {
                    await merchantNotificationService.notifyShop(
                        row.shop_id,
                        NOTIFICATION_EVENTS.DAILY_SALES_SUMMARY,
                        {
                            date,
                            orderCount,
                            salesTotal: Number(row.salesTotal || row.salestotal || 0)
                        },
                        {
                            dedupeKey: `${date}`,
                            dedupeTtlSeconds: DEDUPE_TTL_SECONDS
                        }
                    );
                    results.alertsQueued++;
                }

                this.metrics.recordsSucceeded++;
            } catch (error) {
                this.metrics.recordsFailed++;
                this.metrics.errors.push(`Shop ${row.shop_id}: ${error.message}`);
                this.logger.warn('Failed to queue daily sales summary alert', {
                    shopId: row.shop_id,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = DailySalesSummaryNotifier;
