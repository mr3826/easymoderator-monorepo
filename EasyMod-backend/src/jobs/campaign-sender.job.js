/**
 * Campaign Sender Job
 *
 * Sends a single campaign message to one recipient via Meta Graph API (Send API).
 * Enqueued by campaign.service.js runCampaign() — one job per recipient.
 *
 * Job payload:
 *   { shopId, campaignId, customerId, channelType, channelUserId, channelId, message, customerName }
 *
 * Meta rate limit: 200 calls/hour per page.
 * The campaign-send queue is configured with limiter { max: 180, duration: 3600000 }
 * so we stay safely under the limit.
 */

const META_GRAPH_VERSION = 'v21.0';
const { renderTemplate } = require('../modules/template/response-template.service');

/**
 * Send a Messenger or Instagram DM via Meta Send API.
 */
async function sendMetaDM(channelType, pageId, accessToken, recipientId, messageText) {
    // Messenger and Instagram both use the same Send API endpoint
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}/messages`;
    const body = {
        recipient: { id: recipientId },
        message: { text: messageText },
        messaging_type: 'MESSAGE_TAG',
        tag: 'POST_PURCHASE_UPDATE' // allows sending outside the 24h window to known customers
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const code = err?.error?.code;
        throw Object.assign(
            new Error(err?.error?.message || `Meta API error ${res.status}`),
            { metaCode: code, status: res.status }
        );
    }

    return await res.json();
}

/**
 * Job processor — called by Bull queue-manager with job.data
 */
async function processCampaignSend(job) {
    // Sentinel trigger job: a scheduled campaign fires this at the right time.
    // We delegate to runCampaign which re-queries eligible recipients and enqueues real send jobs.
    if (job.data._trigger) {
        const { runCampaign } = require('../modules/campaign/campaign.service');
        const { createLogger } = require('../utils/structured-logger');
        createLogger('CampaignSender').info('Scheduled campaign trigger fired', {
            campaignId: job.data.campaignId,
            shopId: job.data.shopId
        });
        await runCampaign(job.data.shopId, job.data.campaignId);
        return { triggered: true };
    }

    const {
        shopId,
        campaignId,
        customerId,
        channelType,
        channelUserId,
        channelId,
        message,
        customerName = ''
    } = job.data;

    // Lazy-require to avoid circular deps at module load
    const { Campaign, Channel } = require('../modules/entities');
    const { Op, literal } = require('sequelize');
    const { createLogger } = require('../utils/structured-logger');
    const logger = createLogger('CampaignSender');

    // Fetch channel here so the decrypted access_token is never stored in Redis
    const channel = await Channel.findByPk(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found — aborting job`);

    const markComplete = () => Campaign.update(
        { status: 'completed' },
        {
            where: {
                id: campaignId,
                shop_id: shopId,
                status: 'running',
                [Op.and]: [literal('sent_count + failed_count >= total_recipients')]
            }
        }
    );

    try {
        const rendered = renderTemplate(message, {
            name: customerName || 'বন্ধু',
            first_name: customerName.split(' ')[0] || 'বন্ধু'
        });
        await sendMetaDM(channelType, channel.page_id, channel.access_token, channelUserId, rendered);

        await Campaign.increment('sent_count', { by: 1, where: { id: campaignId, shop_id: shopId } });
        await markComplete();

        logger.info('Campaign message sent', { campaignId, customerId, channelType });

        return { sent: true };
    } catch (err) {
        // Only count failure on the final attempt (not intermediate retries)
        if (job.attemptsMade >= (job.opts.attempts || 1)) {
            await Campaign.increment('failed_count', { by: 1, where: { id: campaignId, shop_id: shopId } });
            await markComplete();
        }

        logger.warn('Campaign message failed', {
            campaignId,
            customerId,
            attempt: job.attemptsMade,
            error: err.message,
            metaCode: err.metaCode
        });

        // Re-throw so Bull can apply retry backoff
        throw err;
    }
}

module.exports = { processCampaignSend };
