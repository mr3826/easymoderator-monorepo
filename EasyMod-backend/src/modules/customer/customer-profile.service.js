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
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');
const { createLogger } = require('../../utils/structured-logger');
const Customer = require('./customer.entity');
const MetaChannel = require('../channel-providers/meta-channel.entity');

const logger = createLogger('CustomerProfile');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const appsecretProof = (token) => {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    if (!secret) return undefined;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
};

const isPlaceholderName = (name) =>
    !name || name === 'Customer' || name.startsWith('Customer ');

// Resolve the channel (and thus the page/IG token) for this customer's platform.
async function resolveChannel({ metaChannelId, shopId, platform }) {
    if (metaChannelId) {
        const ch = await MetaChannel.findByPk(metaChannelId);
        if (ch) return ch;
    }
    if (shopId && platform) {
        // Channels are stored under platform 'facebook' / 'instagram'.
        const normalized = platform === 'messenger' ? 'facebook' : platform;
        return MetaChannel.findOne({ where: { shop_id: shopId, platform: normalized } });
    }
    return null;
}

/**
 * Fetch and persist the real customer name + profile picture from Meta.
 *
 * @param {object}  args
 * @param {string}  args.customerId    - Customer row id (already created)
 * @param {string}  [args.metaChannelId]
 * @param {string}  [args.shopId]
 * @param {string}  [args.platform]    - 'messenger' | 'facebook' | 'instagram'
 * @param {string}  args.psid          - platform user id (PSID / IGSID)
 * @returns {Promise<boolean>} true if the name was updated
 */
async function enrichCustomerNameFromMeta({ customerId, metaChannelId, shopId, platform, psid }) {
    try {
        if (!customerId || !psid) return false;

        const customer = await Customer.findByPk(customerId);
        if (!customer || !isPlaceholderName(customer.name)) return false;

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
        if (!fullName) return false;

        // Re-read inside the update guard: a concurrent order flow may have set a
        // real name in the meantime — don't clobber it with the profile name.
        if (!isPlaceholderName(customer.name)) return false;

        const meta = { ...(customer.metadata || {}) };
        if (d.first_name) meta.first_name = d.first_name;
        if (d.last_name) meta.last_name = d.last_name;
        if (d.profile_pic) meta.profile_pic = d.profile_pic;
        meta.profile_synced_at = new Date().toISOString();

        await customer.update({ name: fullName, metadata: meta });
        logger.info('Enriched customer name from Meta profile', { customerId, hasPic: !!d.profile_pic });
        return true;
    } catch (err) {
        // The user-profile API commonly 403s without the right permission/role or
        // when the user never messaged the page from this token — never fatal.
        logger.warn('Meta profile enrichment skipped', { error: err.response?.data?.error?.message || err.message });
        return false;
    }
}

module.exports = { enrichCustomerNameFromMeta, isPlaceholderName };
