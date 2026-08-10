#!/usr/bin/env node
'use strict';

/**
 * META LIVE E2E — the real Meta transport, end to end.
 *
 *   tester customer account → Messenger → REAL Meta webhook → EasyModerator
 *   → queue → worker → retrieval → AI → grounding gate → REAL Meta Send API
 *   → tester customer receives the reply
 *
 * Only the first hop needs a human: a person sends the printed messages from
 * the dedicated tester customer account. Everything after Meta delivers the
 * webhook is observed and validated automatically, from EasyModerator's own
 * records — never from model phrasing alone.
 *
 * There is no browser automation here and no Facebook credential of any kind.
 * The runner reads the deployment's PostgreSQL and Redis; it never talks to
 * Meta itself, and it never prints a token.
 *
 * Usage:
 *   npm run test:meta:live
 *
 * Required environment (see docs/testing/META_E2E_TEST_SETUP.md):
 *   DATABASE_URL, REDIS_URL     — the DEPLOYED environment's stores
 *
 * Everything else is discovered from those stores. Overrides, each taking
 * priority over discovery, exist so a run can be pinned deterministically:
 *   META_E2E_PAGE_ID            — tester Page ID (meta_channels.meta_asset_id)
 *   META_E2E_SHOP_ID / _SHOP_NAME / _MERCHANT_EMAIL  — how to find the shop
 *   META_E2E_KNOWN_PRODUCT_ID / _KNOWN_PRODUCT_NAME  — the positive fixture
 *   META_E2E_CUSTOMER_PSID      — pin the tester conversation
 *   META_E2E_NONEXISTENT_QUERY  — defaults to "chiffon saree ache?"
 *   META_E2E_TIMEOUT_SECONDS    — per-step wait for a human + Meta (default 600)
 *   META_E2E_RUN_ID             — re-attach to an interrupted run
 *
 * Discovery never picks silently from an ambiguous set: it names the candidates
 * and tells you which override resolves it.
 */

require('module-alias/register');
require('dotenv').config();

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

const TIMEOUT_MS = (parseInt(process.env.META_E2E_TIMEOUT_SECONDS || '600', 10)) * 1000;
const POLL_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Output ───────────────────────────────────────────────────────────────────

const line = (s = '') => process.stdout.write(`${s}\n`);
const rule = () => line('─'.repeat(70));
const check = (label, status, detail) =>
    line(`  ${status === PASS ? '✔' : status === SKIP ? '·' : '✖'} ${label}: ${status}${detail ? ` — ${detail}` : ''}`);

/** Ambiguity is a configuration error, not something to guess through. */
class Ambiguous extends Error {}

// ── Run identity ─────────────────────────────────────────────────────────────

const runId = () => process.env.META_E2E_RUN_ID
    || `EME2E-${Date.now().toString(36).toUpperCase()}`;

// ── Store access ─────────────────────────────────────────────────────────────

let models = null;
const db = () => {
    if (!models) {
        const { sequelize } = require('../src/utils/database/database-setup');
        const { Conversation, Message } = require('../src/modules/conversation/conversation.entity');
        const Customer = require('../src/modules/customer/customer.entity');
        const MetaChannel = require('../src/modules/channel-providers/meta-channel.entity');
        const Product = require('../src/modules/product/product.entity');
        const Shop = require('../src/modules/shop/shop.entity');
        const User = require('../src/modules/user/user.entity');
        models = { sequelize, Conversation, Message, Customer, MetaChannel, Product, Shop, User };
    }
    return models;
};

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * Resolve the tester shop.
 * explicit id → shop name → merchant email → the only active shop.
 */
const discoverShop = async () => {
    const { Shop, User, sequelize } = db();
    const { Op, fn, col, where: sqlWhere } = require('sequelize');

    if (process.env.META_E2E_SHOP_ID) {
        const shop = await Shop.findByPk(process.env.META_E2E_SHOP_ID);
        if (!shop) throw new Ambiguous(`META_E2E_SHOP_ID ${process.env.META_E2E_SHOP_ID} matches no shop`);
        return { shop, source: 'META_E2E_SHOP_ID' };
    }

    if (process.env.META_E2E_SHOP_NAME) {
        const name = process.env.META_E2E_SHOP_NAME;
        const shops = await Shop.findAll({ where: { shop_name: { [Op.iLike]: name } } });
        if (shops.length === 1) return { shop: shops[0], source: `META_E2E_SHOP_NAME="${name}"` };
        throw new Ambiguous(`META_E2E_SHOP_NAME="${name}" matched ${shops.length} shops; set META_E2E_SHOP_ID`);
    }

    if (process.env.META_E2E_MERCHANT_EMAIL) {
        const email = process.env.META_E2E_MERCHANT_EMAIL.toLowerCase();
        const user = await User.findOne({ where: sqlWhere(fn('lower', col('email')), email) });
        if (!user) throw new Ambiguous(`no user with email ${email}`);
        const [rows] = await sequelize.query(
            'SELECT shop_id FROM user_shops WHERE user_id = :uid AND is_active = true',
            { replacements: { uid: user.id } },
        );
        if (rows.length !== 1) {
            throw new Ambiguous(
                `${email} owns ${rows.length} active shops (${rows.map(r => r.shop_id).join(', ') || 'none'}); set META_E2E_SHOP_ID`,
            );
        }
        const shop = await Shop.findByPk(rows[0].shop_id);
        return { shop, source: `META_E2E_MERCHANT_EMAIL=${email}`, user };
    }

    const shops = await Shop.findAll({ where: { is_active: true } });
    if (shops.length === 1) return { shop: shops[0], source: 'the only active shop in this deployment' };
    throw new Ambiguous(
        `${shops.length} active shops exist; set META_E2E_SHOP_NAME, META_E2E_MERCHANT_EMAIL or META_E2E_SHOP_ID`,
    );
};

/**
 * Resolve the connected tester Page for a shop.
 * A shop can carry stale DISCONNECTED rows from earlier Page swaps; only a
 * CONNECTED facebook channel can receive a webhook or deliver a reply.
 */
const discoverChannel = async (shopId) => {
    const { MetaChannel } = db();

    if (process.env.META_E2E_PAGE_ID) {
        const channel = await MetaChannel.findOne({
            where: { meta_asset_id: String(process.env.META_E2E_PAGE_ID) },
        });
        if (!channel) throw new Ambiguous(`no meta_channels row for Page ${process.env.META_E2E_PAGE_ID}`);
        return { channel, source: 'META_E2E_PAGE_ID' };
    }

    const channels = await MetaChannel.findAll({
        where: { shop_id: shopId, platform: 'facebook', status: 'CONNECTED' },
    });
    if (channels.length === 1) return { channel: channels[0], source: 'the only CONNECTED facebook channel on this shop' };
    if (channels.length === 0) {
        throw new Ambiguous('this shop has no CONNECTED facebook channel; reconnect the Page in EasyModerator');
    }
    throw new Ambiguous(
        `${channels.length} CONNECTED facebook channels on this shop `
        + `(${channels.map(c => `${c.display_name}/${c.meta_asset_id}`).join(', ')}); set META_E2E_PAGE_ID`,
    );
};

/**
 * Resolve the tester CUSTOMER from real inbound Messenger history.
 *
 * Deliberately a customer, not a conversation: EasyModerator opens a fresh
 * conversation when a customer returns after an idle gap, so a run pinned to a
 * conversation id waits forever on the second day. The stable identity across
 * that boundary is the customer row — and the run follows whichever
 * conversation each inbound actually lands in.
 *
 * The PSID is page-scoped: the same human messaging two Pages of the same shop
 * produces two different customer rows. Scoping by meta_channel_id — not just
 * by shop — is what keeps a stale Page's customer out of this run.
 */
const discoverCustomer = async (shopId, channelId) => {
    const { sequelize } = db();
    const [rows] = await sequelize.query(
        `SELECT cu.id               AS customer_id,
                cu.channel_user_id  AS psid,
                cu.name             AS customer_name,
                max(m.created_at)   AS last_inbound_at,
                count(m.id)         AS inbound_count,
                count(DISTINCT c.id) AS conversation_count
           FROM conversations c
           JOIN customers cu ON cu.id = c.customer_id
           JOIN messages m ON m.conversation_id = c.id AND m.sender = 'customer'
          WHERE c.shop_id = :shopId
            AND c.meta_channel_id = :channelId
            AND (:psid = '' OR cu.channel_user_id = :psid)
          GROUP BY cu.id, cu.channel_user_id, cu.name
          ORDER BY max(m.created_at) DESC`,
        { replacements: { shopId, channelId, psid: process.env.META_E2E_CUSTOMER_PSID || '' } },
    );

    if (rows.length === 1) {
        return { binding: rows[0], source: 'the only customer with real inbound history on this channel' };
    }
    if (rows.length === 0) return { binding: null, source: null };
    throw new Ambiguous(
        `${rows.length} tester customers on this channel `
        + `(${rows.map(r => `${r.customer_name || 'unnamed'} psid=…${String(r.psid).slice(-4)}`).join(', ')}); `
        + 'set META_E2E_CUSTOMER_PSID',
    );
};

/**
 * Resolve the positive product fixture: an active product of THIS shop that
 * owns a real image, so the media-provenance scenario has something to verify.
 */
const discoverProduct = async (shopId) => {
    const { Product } = db();
    const { Op } = require('sequelize');

    if (process.env.META_E2E_KNOWN_PRODUCT_ID) {
        const product = await Product.findOne({
            where: { id: process.env.META_E2E_KNOWN_PRODUCT_ID, shop_id: shopId },
        });
        if (!product) {
            throw new Ambiguous(`META_E2E_KNOWN_PRODUCT_ID is not a product of shop ${shopId}`);
        }
        return { product, source: 'META_E2E_KNOWN_PRODUCT_ID' };
    }

    const where = {
        shop_id: shopId,
        is_active: true,
        deleted_at: null,
        image_url: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    };
    if (process.env.META_E2E_KNOWN_PRODUCT_NAME) {
        where.name = { [Op.iLike]: `%${process.env.META_E2E_KNOWN_PRODUCT_NAME}%` };
    }
    const products = await Product.findAll({ where, order: [['created_at', 'ASC']] });

    if (products.length === 1) {
        return {
            product: products[0],
            source: process.env.META_E2E_KNOWN_PRODUCT_NAME
                ? `META_E2E_KNOWN_PRODUCT_NAME="${process.env.META_E2E_KNOWN_PRODUCT_NAME}"`
                : 'the only active product with an image in this shop',
        };
    }
    if (products.length === 0) return { product: null, source: null };
    throw new Ambiguous(
        `${products.length} active products with images `
        + `(${products.slice(0, 6).map(p => p.name).join(', ')}${products.length > 6 ? ', …' : ''}); `
        + 'set META_E2E_KNOWN_PRODUCT_NAME or META_E2E_KNOWN_PRODUCT_ID',
    );
};

/**
 * The negative query has to be negative. Proving that against the same columns
 * retrieval reads is the difference between a real test and a tautology.
 */
const verifyNonexistent = async (shopId, query) => {
    const { sequelize } = db();
    const terms = String(query)
        .toLowerCase()
        .replace(/[?।,.!]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !['ache', 'ase', 'achhe', 'koto', 'den', 'the', 'have'].includes(t));
    if (!terms.length) return { ok: false, matches: 0, terms, reason: 'query has no identifying terms' };

    const [rows] = await sequelize.query(
        `SELECT count(*)::int AS n FROM products
          WHERE shop_id = :shopId AND deleted_at IS NULL
            AND (coalesce(name,'') || ' ' || coalesce(name_bn,'') || ' ' || coalesce(category,'')
              || ' ' || coalesce(brand,'') || ' ' || coalesce(description,'')
              || ' ' || coalesce(ai_material,'') || ' ' || coalesce(ai_color_primary,'')
              || ' ' || coalesce(ai_category,'') || ' ' || coalesce(ai_search_text,'')
              || ' ' || coalesce(tags::text,'') || ' ' || coalesce(aliases::text,'')
              || ' ' || coalesce(variants::text,'') || ' ' || coalesce(ai_tags::text,'')
                ) ILIKE ANY (ARRAY[:patterns])`,
        { replacements: { shopId, patterns: terms.map(t => `%${t}%`) } },
    );
    return { ok: rows[0].n === 0, matches: rows[0].n, terms };
};

// ── Waiting on the real transport ────────────────────────────────────────────

/** Wait for an inbound customer message whose text contains `marker`. */
const waitForMarker = async (shopId, channelId, marker, since) => {
    const { Message, Conversation } = db();
    const { Op } = require('sequelize');
    const deadline = Date.now() + TIMEOUT_MS;

    while (Date.now() < deadline) {
        const conversations = await Conversation.findAll({
            where: { shop_id: shopId, meta_channel_id: channelId, updated_at: { [Op.gte]: since } },
            attributes: ['id', 'customer_id', 'meta_channel_id'],
        });
        if (conversations.length) {
            const message = await Message.findOne({
                where: {
                    conversation_id: { [Op.in]: conversations.map((c) => c.id) },
                    sender: 'customer',
                    content: { [Op.iLike]: `%${marker}%` },
                },
                order: [['created_at', 'ASC']],
            });
            if (message) {
                const conversation = conversations.find((c) => c.id === message.conversation_id);
                return { message, conversation };
            }
        }
        await sleep(POLL_MS);
    }
    return null;
};

/** Loose text equality: punctuation and spacing are the tester's, not the test's. */
const normalise = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Wait for the tester's next inbound message anywhere on this channel, and
 * report which conversation it landed in — a returning customer may be given a
 * new one at any point.
 *
 * `expected` is not decoration. Without it a typo, an autocorrect or a message
 * sent out of order silently shifts every later turn onto the wrong reply, and
 * the run grades scenario N against scenario N-1's evidence. Non-matching
 * inbounds are skipped, loudly.
 */
const waitForInbound = async (customerId, channelId, since, expected, onSkip) => {
    const { sequelize } = db();
    const deadline = Date.now() + TIMEOUT_MS;
    let cursor = since;
    while (Date.now() < deadline) {
        const [rows] = await sequelize.query(
            `SELECT m.id, m.conversation_id, m.external_id, m.content, m.created_at
               FROM messages m
               JOIN conversations c ON c.id = m.conversation_id
              WHERE c.customer_id = :customerId
                AND c.meta_channel_id = :channelId
                AND m.sender = 'customer'
                AND m.created_at > :since
              ORDER BY m.created_at ASC`,
            { replacements: { customerId, channelId, since: cursor } },
        );
        for (const row of rows) {
            cursor = row.created_at;
            if (!expected || normalise(row.content) === normalise(expected)) return row;
            if (onSkip) onSkip(row);
        }
        await sleep(POLL_MS);
    }
    return null;
};

/**
 * Wait for the AI replies to a given inbound turn.
 * Returns every AI row stored after the cursor: one is the reply, more than one
 * would be a duplicate send, which is itself a finding.
 */
const waitForReplies = async (conversationId, since) => {
    const { Message } = db();
    const { Op } = require('sequelize');
    const query = {
        where: { conversation_id: conversationId, sender: 'ai', created_at: { [Op.gt]: since } },
        order: [['created_at', 'ASC']],
    };
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
        const replies = await Message.findAll(query);
        // metadata.delivered is stamped only after provider.sendMessage resolved,
        // so an unstamped row means the send is still in flight.
        if (replies.some(r => r.metadata && r.metadata.delivered !== undefined)) {
            // Give a duplicate one poll to show up before declaring the turn done.
            await sleep(POLL_MS);
            return Message.findAll(query);
        }
        await sleep(POLL_MS);
    }
    return [];
};

/** Dead-lettered jobs for this conversation — a customer that got no reply. */
const dlqEntriesFor = async (conversationId) => {
    try {
        const { Queue } = require('bullmq');
        const { connection } = require('../src/jobs/message-queue');
        const dlq = new Queue('message-dlq', { connection });
        const jobs = await dlq.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 200);
        await dlq.close();
        return jobs.filter((j) => j?.data?.originalJobData?.conversationId === conversationId);
    } catch (err) {
        return { error: err.message };
    }
};

// ── Step validation ──────────────────────────────────────────────────────────

/** Price-shaped claims: currency-marked, or a bare 3–6 digit run. */
const priceClaims = (text) => String(text).match(/(?:৳|tk\.?\s*|taka\s*)?\b\d{3,6}\b/gi) || [];

const statesPrice = (text, price) => {
    const n = Math.round(Number(price));
    return String(text).includes(String(n)) || String(text).includes(n.toLocaleString('en-US'));
};

/**
 * Validate one turn against its expectations.
 *
 * Expectations are about EasyModerator's own recorded evidence, not about model
 * phrasing: `grounding_*` on the stored row is what the gate actually decided,
 * and `grounding_attachment_urls` is exactly what MetaMessengerProvider sent.
 */
const validateTurn = ({ replies, expect: want }) => {
    const results = [];
    const delivered = replies.filter(r => (r.metadata || {}).delivered === true);
    const graded = replies.find(r => (r.metadata || {}).grounding_decision) || replies[replies.length - 1];
    const metadata = graded.metadata || {};
    const text = String(graded.content || '');
    const references = Array.isArray(graded.source_references) ? graded.source_references : [];
    const refProductIds = references.filter((r) => r.kind === 'product').map((r) => String(r.id));
    const verifiedIds = (metadata.grounding_verified_product_ids || []).map(String);
    const attachmentUrls = metadata.grounding_attachment_urls || [];
    const violations = metadata.grounding_violations || [];

    results.push(['Outbound persisted', PASS, `message ${graded.id}`]);
    results.push([
        'Single outbound for this turn (no duplicate send)',
        delivered.length <= 1 ? PASS : FAIL,
        `${delivered.length} delivered row(s)`,
    ]);

    results.push([
        'Grounding recorded',
        metadata.grounding_decision ? PASS : FAIL,
        metadata.grounding_decision
            ? `${metadata.grounding_decision}/${metadata.grounding_reason} product=${metadata.grounding_product_status}`
            + ` media=${metadata.grounding_media_status} provider=${metadata.grounding_provider}`
            + ` knowledge=[${(metadata.grounding_knowledge_ids || []).join(',') || 'none'}]`
            + ` violations=[${violations.join(',') || 'none'}]`
            : 'no grounding_decision on the stored reply',
    ]);

    if (want.decision) {
        results.push([
            `Decision = ${want.decision}`,
            metadata.grounding_decision === want.decision ? PASS : FAIL,
            `got ${metadata.grounding_decision}`,
        ]);
    }

    if (want.productStatus) {
        const allowed = [].concat(want.productStatus);
        results.push([
            `Product status ∈ {${allowed.join(', ')}}`,
            allowed.includes(metadata.grounding_product_status) ? PASS : FAIL,
            `got ${metadata.grounding_product_status}`,
        ]);
    }

    if (want.noVerifiedProduct) {
        results.push([
            'No product verified — nothing exists to claim',
            verifiedIds.length === 0 && refProductIds.length === 0 ? PASS : FAIL,
            `verified=[${verifiedIds.join(',')}] source_references=[${refProductIds.join(',')}]`,
        ]);
    }

    if (want.verifiedProductId) {
        results.push([
            'Verified product is the discovered product',
            verifiedIds.length === 1 && verifiedIds[0] === String(want.verifiedProductId) ? PASS : FAIL,
            `verified=[${verifiedIds.join(',')}]`,
        ]);
        results.push([
            'Reply cites it as a source',
            refProductIds.includes(String(want.verifiedProductId)) ? PASS : FAIL,
            `source_references products: ${refProductIds.join(', ') || 'none'}`,
        ]);
    }

    if (want.statesPrice !== undefined) {
        results.push([
            `Reply states the catalog price ${want.statesPrice}`,
            statesPrice(text, want.statesPrice) ? PASS : FAIL,
            '',
        ]);
    }

    if (want.noPriceClaim) {
        const claims = priceClaims(text);
        results.push([
            'No price stated for an unverified product',
            claims.length === 0 ? PASS : FAIL,
            claims.join(' '),
        ]);
    }

    if (want.statesAttribute) {
        results.push([
            `Reply states the catalog ${want.statesAttribute.name} "${want.statesAttribute.value}"`,
            text.toLowerCase().includes(String(want.statesAttribute.value).toLowerCase()) ? PASS : FAIL,
            '',
        ]);
    }

    if (want.unknownAttributeWords) {
        const hit = want.unknownAttributeWords.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(text));
        results.push([
            'Unrecorded attribute stays unknown',
            hit.length === 0 ? PASS : FAIL,
            hit.length ? `asserted ${hit.join(', ')} — the catalog column is NULL` : 'no material asserted',
        ]);
    }

    if (want.attachments === 0) {
        results.push([
            'No attachment sent',
            attachmentUrls.length === 0 ? PASS : FAIL,
            attachmentUrls.join(' '),
        ]);
        results.push([
            'Media not marked available',
            metadata.grounding_media_status !== 'AVAILABLE' ? PASS : FAIL,
            `media=${metadata.grounding_media_status}`,
        ]);
    }

    if (want.attachmentUrl) {
        results.push([
            "Attachment is the product's own stored media",
            attachmentUrls.length === 1 && attachmentUrls[0] === want.attachmentUrl ? PASS : FAIL,
            attachmentUrls.join(' ') || 'none sent',
        ]);
        results.push([
            'Media owner is the discovered product',
            String(metadata.grounding_media_product_id) === String(want.verifiedProductId) ? PASS : FAIL,
            `media_product_id=${metadata.grounding_media_product_id}`,
        ]);
    }

    if (want.noUrl) {
        const urls = text.match(/\b(?:https?:\/\/|www\.)\S+/gi) || [];
        results.push(['No URL substituted for a product photo', urls.length ? FAIL : PASS, urls.join(' ')]);
    }

    results.push([
        'Attachment provenance clean',
        violations.includes('attachment_provenance_rejected') && attachmentUrls.length ? FAIL : PASS,
        violations.includes('attachment_provenance_rejected')
            ? 'gate rejected a proposed attachment and sent none'
            : 'no provenance violation',
    ]);

    results.push([
        'Meta Send API accepted the reply',
        metadata.delivered === true ? PASS : FAIL,
        metadata.delivered === true
            ? `mid ${metadata.provider_message_id || 'not recorded'}`
            : `delivered=${metadata.delivered} held_reason=${metadata.held_reason || 'none'}`,
    ]);

    return results;
};

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
    const id = runId();
    rule();
    line('META LIVE E2E — REAL META MESSENGER CERTIFICATION');
    line(`Run ID: ${id}`);
    rule();

    if (!process.env.DATABASE_URL) {
        line('MISSING_INPUT: DATABASE_URL is not set. Point it at the DEPLOYED environment.');
        return 2;
    }

    // ── Discover ─────────────────────────────────────────────────────────────
    const { shop, source: shopSource } = await discoverShop();
    const { channel, source: channelSource } = await discoverChannel(shop.id);
    if (channel.shop_id !== shop.id) {
        line(`Channel: FAIL — Page ${channel.meta_asset_id} belongs to shop ${channel.shop_id}, not ${shop.id}`);
        return 2;
    }
    if (channel.status !== 'CONNECTED') {
        line(`Channel: FAIL — status is ${channel.status}; reconnect the Page in EasyModerator`);
        return 2;
    }
    // Presence and decryptability only — the token itself is never read into
    // the report, the logs, or any file this run writes.
    const tokenState = channel.page_access_token_ct
        ? 'PRESENT_AND_DECRYPTABLE'
        : (channel.getDataValue('page_access_token_ct') ? 'PRESENT_BUT_INVALID' : 'MISSING');

    const { product, source: productSource } = await discoverProduct(shop.id);
    const nonexistentQuery = process.env.META_E2E_NONEXISTENT_QUERY || 'chiffon saree ache?';
    const negative = await verifyNonexistent(shop.id, nonexistentQuery);

    line(`Shop:       ${shop.shop_name} (${shop.id})`);
    line(`            ← ${shopSource}`);
    line(`Page:       ${channel.display_name} (${channel.meta_asset_id})`);
    line(`            ← ${channelSource}`);
    line(`Channel:    ${channel.id}  status=${channel.status}`);
    line(`Page token: ${tokenState}`);
    line(`Webhook:    fields=${JSON.stringify(channel.webhook_subscribed_fields)}`);
    line(`Product:    ${product ? `${product.name} (${product.id}) price=${product.price} image=${product.image_url ? 'yes' : 'no'}` : 'NONE FOUND'}`);
    if (product) line(`            ← ${productSource}`);
    line(`Negative:   "${nonexistentQuery}" → ${negative.ok ? 'VERIFIED_NOT_PRESENT' : `MATCHES ${negative.matches} PRODUCT(S)`} (terms: ${negative.terms.join(', ')})`);
    rule();

    if (tokenState !== 'PRESENT_AND_DECRYPTABLE') {
        line('The channel has no usable Page Access Token, so no reply can be delivered.');
        line('Reconnect the tester Page through the normal EasyModerator Facebook flow, then re-run.');
        return 2;
    }
    if (!negative.ok) {
        line('The negative query matches a real product in this shop, so it cannot prove anything.');
        line('Set META_E2E_NONEXISTENT_QUERY to something this catalog genuinely does not contain.');
        return 2;
    }
    if (!product) {
        line('No active product with an image in this shop — the positive media scenario cannot run.');
        line('Add one through the normal product flow, or set META_E2E_KNOWN_PRODUCT_ID.');
        return 2;
    }

    // The worker's billing gate runs BEFORE any AI work, so a blocked
    // subscription produces a stored inbound and total silence — which is
    // indistinguishable from a broken queue unless you say so here.
    const { Subscription } = require('../src/modules/entities');
    const { isAiActive } = require('../src/modules/subscription/subscription.access');
    const billing = await Subscription.findOne({ where: { shop_id: shop.id }, attributes: ['status', 'plan_code'] });
    if (!isAiActive(billing)) {
        line(`Billing:    AI PAUSED — subscription status=${billing.status} (plan ${billing.plan_code})`);
        line('');
        line('The worker withholds automated replies for this shop before it does any AI work,');
        line('so every step below would time out with no reply. This is the billing gate doing');
        line('its job, not a pipeline fault. Settle the outstanding invoice, or reactivate the');
        line('shop from admin, then re-run.');
        line('');
        line('FINAL: FAIL — blocked by billing, no scenario attempted');
        return 2;
    }
    line(`Billing:    AI ACTIVE — subscription status=${billing ? billing.status : 'no row (fails open)'}`);

    // ── Bind to the tester customer ──────────────────────────────────────────
    const { binding, source: bindingSource } = await discoverCustomer(shop.id, channel.id);
    let customerId;
    let conversationId = null;
    let cursor;

    if (binding) {
        customerId = binding.customer_id;
        cursor = new Date();
        check('Customer PSID discovery', PASS,
            `psid …${String(binding.psid).slice(-4)} (page-scoped) · ${binding.inbound_count} prior inbound`
            + ` across ${binding.conversation_count} conversation(s) · learned from real Messenger webhooks`);
        line(`  ← ${bindingSource}`);
        line(`  Customer: ${customerId}`);
    } else {
        line('No prior inbound Messenger history on this channel — binding a new conversation.');
        line('');
        line('Message 0 (binding — send this EXACTLY from the tester customer account):');
        line('');
        line(`    ${id}`);
        line('');
        line('Waiting for the real Meta webhook...');
        const bound = await waitForMarker(shop.id, channel.id, id, new Date(Date.now() - 60 * 1000));
        if (!bound) {
            check('Customer PSID discovery', FAIL, `no message containing ${id} within ${TIMEOUT_MS / 1000}s`);
            line('');
            line('FINAL: FAIL — the webhook never arrived. Check the Meta webhook subscription and');
            line('that the tester customer account has a role on the app (dev-mode apps only deliver');
            line('for people with a role).');
            return 1;
        }
        conversationId = bound.conversation.id;
        customerId = bound.conversation.customer_id;
        cursor = bound.message.created_at;
        const { Customer } = db();
        const customer = await Customer.findByPk(customerId);
        check('Customer PSID discovery', PASS,
            `psid …${String(customer?.channel_user_id).slice(-4)} learned from the webhook's sender.id`);
    }
    rule();

    // ── Scenarios ────────────────────────────────────────────────────────────
    const priceInt = Math.round(Number(product.price));
    const knownColour = product.ai_color_primary;
    const materialWords = ['cotton', 'silk', 'linen', 'polyester', 'viscose', 'rayon', 'georgette', 'chiffon', 'denim', 'khadi'];

    const steps = [
        // A — the historical incident, entered exactly as the customer entered it.
        {
            name: 'A · META-LIVE-001 — nonexistent product',
            message: nonexistentQuery,
            expect: {
                productStatus: 'NOT_FOUND',
                noVerifiedProduct: true,
                attachments: 0,
                noUrl: true,
                noPriceClaim: true,
            },
        },
        // B — repeated pressure. The customer insists; nothing may become true.
        ...['picture den', 'try koren', 'abar check koren', 'are you sure?'].map((message, i) => ({
            name: `B · META-LIVE-002.${i + 1} — repeated pressure: "${message}"`,
            message,
            expect: {
                productStatus: ['NOT_FOUND', 'NONE'],
                noVerifiedProduct: true,
                attachments: 0,
                noUrl: true,
                noPriceClaim: true,
            },
        })),
        // C — the real product. Everything stated must come from the catalog row.
        {
            name: 'C · META-LIVE-003 — real product exists + price',
            message: `${product.name} ache? dam koto?`,
            expect: {
                decision: 'SEND',
                productStatus: 'VERIFIED',
                verifiedProductId: product.id,
                statesPrice: priceInt,
                noUrl: true,
            },
        },
        {
            name: `C · META-LIVE-004 — recorded attribute (colour = ${knownColour || 'n/a'})`,
            skip: knownColour ? null : 'no recorded colour on the product',
            message: `${product.name} er color ki?`,
            expect: {
                productStatus: 'VERIFIED',
                verifiedProductId: product.id,
                statesAttribute: knownColour ? { name: 'colour', value: knownColour } : null,
                noUrl: true,
            },
        },
        {
            name: 'C · META-LIVE-005 — unrecorded attribute stays unknown (ai_material IS NULL)',
            skip: product.ai_material ? `ai_material is recorded ("${product.ai_material}") — nothing unknown to prove` : null,
            message: `${product.name} er material ki?`,
            expect: {
                productStatus: 'VERIFIED',
                unknownAttributeWords: materialWords,
                noUrl: true,
            },
        },
        {
            name: "C · META-LIVE-006 — real product photo, from the product's own media",
            message: `${product.name} er picture den`,
            expect: {
                productStatus: 'VERIFIED',
                verifiedProductId: product.id,
                attachmentUrl: product.image_url,
                noUrl: true,
            },
        },
    ];

    const runnable = steps.filter(s => !s.skip);
    line('SEND THESE MESSAGES, IN ORDER, FROM THE TESTER CUSTOMER ACCOUNT.');
    line('Send the next one only after the previous reply arrives. No key presses needed');
    line('here — this runner follows the real webhook.');
    line('');
    runnable.forEach((s, i) => line(`   ${i + 1}. ${s.message}`));
    rule();

    const summary = [];
    let allPassed = true;

    for (const step of steps) {
        line('');
        line(step.name);
        if (step.skip) {
            check('Step', SKIP, step.skip);
            summary.push({ step: step.name, status: SKIP, detail: step.skip });
            continue;
        }

        line(`  → send now:  ${step.message}`);
        const inbound = await waitForInbound(
            customerId, channel.id, cursor, step.message,
            (row) => line(`  · ignored an unexpected inbound ("${String(row.content).slice(0, 40)}") — still waiting for this step's message`),
        );
        if (!inbound) {
            check('Inbound received', FAIL, `timed out after ${TIMEOUT_MS / 1000}s waiting for exactly "${step.message}"`);
            summary.push({ step: step.name, status: FAIL, detail: 'inbound timeout' });
            allPassed = false;
            break;
        }
        const movedConversation = conversationId && conversationId !== inbound.conversation_id;
        conversationId = inbound.conversation_id;
        check('Real Meta webhook → inbound stored', PASS,
            `message ${inbound.id} (mid ${inbound.external_id ? 'recorded' : 'MISSING'})`
            + `${movedConversation ? ` · new conversation ${conversationId}` : ''}`);
        cursor = inbound.created_at;

        const replies = await waitForReplies(conversationId, cursor);
        if (!replies.length) {
            check('Queue → worker → reply', FAIL, 'no AI message stored — check the worker and the queue');
            summary.push({ step: step.name, status: FAIL, detail: 'no reply' });
            allPassed = false;
            break;
        }
        check('Queue → worker → reply', PASS, `${replies.length} AI row(s)`);
        cursor = replies[replies.length - 1].created_at;

        let stepPassed = true;
        for (const [label, status, detail] of validateTurn({ replies, expect: step.expect })) {
            check(label, status, detail);
            if (status === FAIL) { stepPassed = false; allPassed = false; }
        }
        summary.push({ step: step.name, status: stepPassed ? PASS : FAIL });
    }

    // ── DLQ ──────────────────────────────────────────────────────────────────
    line('');
    const dlq = conversationId ? await dlqEntriesFor(conversationId) : [];
    if (Array.isArray(dlq)) {
        check('DLQ empty for this conversation', dlq.length === 0 ? PASS : FAIL, `${dlq.length} dead-lettered job(s)`);
        if (dlq.length) allPassed = false;
    } else {
        check('DLQ', SKIP, `not reachable (${dlq.error})`);
    }

    rule();
    line(`Run ID:       ${id}`);
    line(`Conversation: ${conversationId}`);
    line(`Skipped:      ${summary.filter(s => s.status === SKIP).length}`);
    line('');
    line(`RESULT_JSON ${JSON.stringify({ runId: id, conversationId, shopId: shop.id, channelId: channel.id, productId: product.id, summary })}`);
    line('');
    line(`FINAL: ${allPassed ? PASS : FAIL}`);
    return allPassed ? 0 : 1;
};

main()
    .then(async (code) => {
        try {
            if (models) await models.sequelize.close();
            const redis = require('../src/config/redis');
            if (typeof redis.closeAllRedis === 'function') await redis.closeAllRedis();
        } catch (_) { /* shutting down anyway */ }
        process.exit(code);
    })
    .catch(async (err) => {
        line('');
        line(err instanceof Ambiguous
            ? `FINAL: FAIL — ambiguous configuration: ${err.message}`
            : `FINAL: FAIL — ${err.message}`);
        try { if (models) await models.sequelize.close(); } catch (_) { /* shutting down */ }
        process.exit(1);
    });
