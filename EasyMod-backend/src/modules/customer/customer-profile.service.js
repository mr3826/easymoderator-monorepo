'use strict';

/**
 * Customer profile enrichment (Meta Graph user-profile API).
 *
 * On a customer's FIRST inbound message we create the Customer row with a
 * generic `name: 'Customer'` placeholder (conversation-state-standalone.service)
 * because the webhook payload carries only the PSID/IGSID, not a name. That left
 * every conversation showing "Customer" — the founder's "app can't detect the
 * user info" report (2026-06-12).
 *
 * This service best-effort fetches the real name + profile picture from the
 * Graph user-profile API using the page/IG access token and stores them.
 *
 * NOTE on gender: Meta removed `gender` from the Messenger user-profile API
 * years ago. With pages_messaging we can reliably get first_name / last_name /
 * profile_pic (and `name`/`username` on Instagram), but NOT gender — so we do
 * not request or store it.
 *
 * Always fire-and-forget from the hot ingest path: this MUST never throw and
 * MUST never block message processing.
 *
 * Business Asset User Profile Access is outside the current Meta review scope,
 * so this integration remains opt-in via META_USER_PROFILE_ENABLED.
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');
const { createLogger } = require('../../utils/structured-logger');
const Customer = require('./customer.entity');
const metaChannelService = require('../channel-providers/meta-channel.service');
const sseManager = require('../../utils/sse-manager');

const logger = createLogger('CustomerProfile');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const appsecretProof = (token) => {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    if (!secret) return undefined;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
};

const isPlaceholderName = (name) => {
    if (!name) return true;
    const normalized = String(name).trim().toLowerCase();
    return normalized === 'customer'
        || normalized.startsWith('customer ')
        || normalized === 'facebook user'
        || normalized.startsWith('facebook customer ·')
        || normalized === 'messenger user'
        || normalized === 'instagram user';
};

const hasMissingProfileFields = (metadata = {}) =>
    !metadata.first_name || !metadata.last_name || !metadata.profile_pic;

// Resolve the exact Page channel, and therefore the token, for this customer.
async function resolveChannel({ metaChannelId, shopId, platform }) {
    const normalized = platform === 'messenger' ? 'facebook' : platform;
    if (metaChannelId) {
        return metaChannelService.findConnectedById(metaChannelId, {
            shopId,
            platform: normalized,
        });
    }
    if (shopId && normalized) {
        return metaChannelService.findUniqueConnectedByShopAndPlatform(shopId, normalized);
    }
    return null;
}

/**
 * Fetch and persist the real customer name + profile picture from Meta.
 *
 * @param {object}  args
 * @param {string}  args.customerId    - Customer row id (already created)
 * @param {string}  [args.metaChannelId]
 * @param {string}  [args.shopId]      - required when metaChannelId is supplied
 * @param {string}  [args.platform]    - 'messenger' | 'facebook'; required with metaChannelId
 * @param {string}  args.psid          - platform user id (PSID / IGSID)
 * @returns {Promise<boolean>} true if the name was updated
 */
async function enrichCustomerNameFromMeta({ customerId, metaChannelId, shopId, platform, psid }) {
    try {
        if (process.env.META_USER_PROFILE_ENABLED !== 'true') return false;
        if (!customerId || !psid) return false;

        const customer = typeof Customer.findOne === 'function'
            ? await Customer.findOne({
                where: {
                    id: customerId,
                    ...(shopId ? { shop_id: shopId } : {}),
                    ...(metaChannelId ? { meta_channel_id: metaChannelId } : {}),
                },
            })
            : await Customer.findByPk(customerId);
        if (!customer) return false;
        const normalizedPlatform = platform === 'facebook' ? 'messenger' : platform;
        if (shopId && customer.shop_id != null && String(customer.shop_id) !== String(shopId)) return false;
        if (normalizedPlatform && customer.channel_type && customer.channel_type !== normalizedPlatform) return false;
        if (customer.channel_user_id && String(customer.channel_user_id) !== String(psid)) return false;
        if (metaChannelId && customer.meta_channel_id != null
            && String(customer.meta_channel_id) !== String(metaChannelId)) return false;

        const hadPlaceholderName = isPlaceholderName(customer.name);
        if (!hadPlaceholderName && !hasMissingProfileFields(customer.metadata || {})) return false;

        const channel = await resolveChannel({ metaChannelId, shopId, platform });
        const token = channel?.page_access_token_ct; // entity getter decrypts
        if (!token) return false;

        const params = {
            fields: 'first_name,last_name,name,profile_pic',
            access_token: token,
        };
        const proof = appsecretProof(token);
        if (proof) params.appsecret_proof = proof;

        const resp = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(psid)}`, {
            params,
            timeout: 5000,
        });
        const d = resp.data || {};
        const fullName = (d.name && d.name.trim())
            || [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
        if (!fullName && !d.profile_pic && !d.first_name && !d.last_name) return false;

        // Re-read inside the update guard: a concurrent order flow may have set a
        // real name in the meantime — don't clobber it with the profile name.
        const shouldUpdateName = isPlaceholderName(customer.name) && fullName;

        const meta = { ...(customer.metadata || {}) };
        if (d.first_name) meta.first_name = d.first_name;
        if (d.last_name) meta.last_name = d.last_name;
        if (d.profile_pic) meta.profile_pic = d.profile_pic;
        meta.profile_synced_at = new Date().toISOString();

        const update = { metadata: meta };
        if (shouldUpdateName) update.name = fullName;

        await customer.update(update);
        if (shopId) {
            sseManager.emit(shopId, 'customer_updated', {
                customer_id: customer.id,
                name: update.name || customer.name,
                profile_pic: meta.profile_pic || null,
                meta_channel_id: metaChannelId || null,
            });
        }
        logger.info('Enriched customer profile from Meta', {
            customerId,
            updatedName: !!shouldUpdateName,
            hasPic: !!d.profile_pic
        });
        return true;
    } catch (err) {
        // The user-profile API commonly 403s without the right permission/role or
        // when the user never messaged the page from this token — never fatal.
        logger.warn('Meta profile enrichment skipped', { error: err.response?.data?.error?.message || err.message });
        return false;
    }
}

module.exports = { enrichCustomerNameFromMeta, isPlaceholderName };
