const BaseJob = require('./base-job');
const { Shop } = require('../modules/entities');
const productSyncService = require('../modules/integration/inventory-sync-product.service');

/**
 * GoogleSheetsSyncJob
 *
 * Hourly job that syncs product quantities from Google Sheets for every shop
 * that has a `google_sheet_id` saved in `shop.settings.bd`.
 *
 * Only touches products where `track_quantity = true`.
 * Uses `inventory-sync-product.service.js` which already handles SKU matching,
 * quantity updates, and sync logging.
 *
 * Schedule: Every hour — cron '0 * * * *'
 * Usage:
 *   node src/jobs/job-runner.js google_sheets_sync --dry-run
 *   node src/jobs/job-runner.js google_sheets_sync
 */
class GoogleSheetsSyncJob extends BaseJob {
    constructor() {
        super('google_sheets_sync');
    }

    async run({ dryRun }) {
        // Find all shops with google_sheet_id configured in BD settings
        const shops = await Shop.findAll({
            attributes: ['id', 'shop_name', 'settings']
        });

        const shopsWithSheet = shops.filter(s => s.settings?.bd?.google_sheet_id);

        this.logger.info(`[GoogleSheetsSyncJob] Found ${shopsWithSheet.length} shops with Google Sheets configured`);

        let synced = 0;
        let failed = 0;

        for (const shop of shopsWithSheet) {
            try {
                if (dryRun) {
                    this.logger.info(`[DRY RUN] Would sync shop ${shop.id} (${shop.shop_name}) from Google Sheets`);
                    synced++;
                    continue;
                }

                const result = await productSyncService.syncProductInventory(shop.id, 'google_sheets');
                this.logger.info(`[GoogleSheetsSyncJob] Synced shop ${shop.id}`, result);
                this.metrics.recordsProcessed += result.matched || 0;
                this.metrics.recordsSucceeded += result.updated || 0;
                synced++;
            } catch (err) {
                this.logger.error(`[GoogleSheetsSyncJob] Failed for shop ${shop.id}: ${err.message}`);
                this.metrics.recordsFailed++;
                failed++;
            }
        }

        return {
            shops_checked: shopsWithSheet.length,
            shops_synced: synced,
            shops_failed: failed,
            dryRun
        };
    }
}

module.exports = GoogleSheetsSyncJob;
