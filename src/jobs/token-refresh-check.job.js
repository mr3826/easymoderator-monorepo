const BaseJob = require('./base-job');
const { Channel, Shop } = require('../modules/entities');
const { Op } = require('sequelize');

/**
 * Token Refresh Check Job
 *
 * Meta (Facebook/Instagram/WhatsApp) System User tokens are long-lived but
 * they do NOT support programmatic refresh — the shop owner must re-authenticate
 * through the Meta Business Manager UI.
 *
 * This job:
 *   1. Finds all channels whose token_expires_at falls within the next 7 days
 *      (or has already expired).
 *   2. Logs a warning to the structured logger so monitoring can alert on-call.
 *   3. Creates a notification record (stored in the Shop's settings.notifications
 *      array) so the shop owner sees the alert on next dashboard load.
 *
 * IDEMPOTENT: Re-running for the same date emits the same set of warnings;
 *             notifications are keyed by channel_id + expiry date so they are
 *             not duplicated.
 *
 * Usage:
 *   const job = new TokenRefreshCheckJob();
 *   await job.execute({ dryRun: true });  // preview — no DB writes
 *   await job.execute({ dryRun: false }); // production run
 *
 * Schedule: Run daily, e.g. cron '0 8 * * *' (08:00 UTC)
 */
class TokenRefreshCheckJob extends BaseJob {
    constructor() {
        super('token_refresh_check');
        this.WARNING_DAYS = 7; // Warn this many days before expiry
    }

    /**
     * Main run method called by BaseJob.execute()
     * @param {Object} options
     * @param {boolean} options.dryRun
     * @param {Date}    options.runDate
     * @param {string}  options.executionId
     */
    async run({ dryRun, runDate, executionId }) {
        this.logger.info(`[${this.jobName}] Checking for expiring Meta tokens`, {
            dryRun,
            runDate,
            warningWindowDays: this.WARNING_DAYS
        });

        const results = {
            channelsChecked: 0,
            channelsExpiringSoon: 0,
            channelsAlreadyExpired: 0,
            notificationsCreated: 0,
            details: []
        };

        const now = runDate || new Date();
        const warningThreshold = new Date(now.getTime() + this.WARNING_DAYS * 24 * 60 * 60 * 1000);

        // Find all active channels that have a token_expires_at set AND it falls
        // within the warning window (including already-expired tokens).
        const expiringChannels = await Channel.findAll({
            where: {
                is_active: true,
                token_expires_at: {
                    [Op.not]: null,
                    [Op.lte]: warningThreshold   // expires_at <= (now + 7 days)
                }
            },
            include: [
                {
                    model: Shop,
                    as: 'shop',
                    required: true,
                    attributes: ['id', 'name', 'settings']
                }
            ],
            order: [['token_expires_at', 'ASC']]
        });

        results.channelsChecked = expiringChannels.length;
        this.metrics.recordsProcessed = expiringChannels.length;

        for (const channel of expiringChannels) {
            try {
                const expiresAt = new Date(channel.token_expires_at);
                const isExpired = expiresAt <= now;
                const daysUntilExpiry = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));

                const detail = {
                    channelId: channel.id,
                    shopId: channel.shop_id,
                    shopName: channel.shop?.name || 'Unknown',
                    channelType: channel.channel_type,
                    expiresAt: expiresAt.toISOString(),
                    daysUntilExpiry,
                    isExpired
                };

                results.details.push(detail);

                if (isExpired) {
                    results.channelsAlreadyExpired++;
                    this.logger.warn(`[${this.jobName}] Token EXPIRED for channel`, detail);
                } else {
                    results.channelsExpiringSoon++;
                    this.logger.warn(`[${this.jobName}] Token expiring in ${daysUntilExpiry} day(s)`, detail);
                }

                if (!dryRun) {
                    await this._createNotification(channel, expiresAt, daysUntilExpiry, isExpired);
                    results.notificationsCreated++;
                }

                this.metrics.recordsSucceeded++;
            } catch (error) {
                this.logger.error(
                    `[${this.jobName}] Failed to process channel ${channel.id}`,
                    error
                );
                this.metrics.recordsFailed++;
                this.metrics.errors.push(`Channel ${channel.id}: ${error.message}`);
            }
        }

        this.logger.info(`[${this.jobName}] Token refresh check complete`, results);
        return results;
    }

    /**
     * Write a notification record into the shop's settings.notifications array.
     * Uses a stable notification ID (channel_id + expiry date string) so re-running
     * the job on the same day does not create duplicate alerts.
     *
     * @param {Object} channel       - Sequelize Channel instance (with .shop)
     * @param {Date}   expiresAt     - Token expiry date
     * @param {number} daysUntilExpiry
     * @param {boolean} isExpired
     */
    async _createNotification(channel, expiresAt, daysUntilExpiry, isExpired) {
        const shop = channel.shop;
        if (!shop) return;

        const expiryDateStr = expiresAt.toISOString().split('T')[0]; // YYYY-MM-DD
        const notificationId = `token-expiry:${channel.id}:${expiryDateStr}`;

        // Parse current settings safely
        let settings = {};
        if (shop.settings && typeof shop.settings === 'object') {
            settings = shop.settings;
        } else if (typeof shop.settings === 'string') {
            try { settings = JSON.parse(shop.settings); } catch (_) { settings = {}; }
        }

        const notifications = Array.isArray(settings.notifications)
            ? settings.notifications
            : [];

        // Idempotency: skip if this notification was already written today
        const alreadyExists = notifications.some(n => n.id === notificationId);
        if (alreadyExists) return;

        const channelLabel = channel.channel_type.charAt(0).toUpperCase()
            + channel.channel_type.slice(1);

        const newNotification = {
            id: notificationId,
            type: 'token_expiry_warning',
            severity: isExpired ? 'error' : 'warning',
            channel_id: channel.id,
            channel_type: channel.channel_type,
            title: isExpired
                ? `${channelLabel} token has expired`
                : `${channelLabel} token expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`,
            message: isExpired
                ? `Your ${channelLabel} access token has expired. The channel is no longer receiving messages. Please reconnect your ${channelLabel} account in Channel Settings to generate a new token.`
                : `Your ${channelLabel} access token will expire on ${expiryDateStr}. Please reconnect your ${channelLabel} account in Channel Settings before it expires to avoid service interruption.`,
            action_required: true,
            action_url: `/settings/channels`,
            expires_at: expiresAt.toISOString(),
            created_at: new Date().toISOString(),
            read: false
        };

        // Keep only the last 50 notifications to prevent unbounded growth
        const updatedNotifications = [newNotification, ...notifications].slice(0, 50);

        await shop.update({
            settings: {
                ...settings,
                notifications: updatedNotifications
            }
        });
    }
}

module.exports = TokenRefreshCheckJob;
