/**
 * ConsentService
 *
 * Per-channel consent tracking using `customers.messaging_consent` JSONB (Phase 5).
 *
 * Shape of messaging_consent column:
 *   {
 *     facebook:  { opted_in: true, opted_out_at: null,                last_inbound_at: '2026-...' },
 *     instagram: { opted_in: true, opted_out_at: '2026-05-19T10:00Z', last_inbound_at: '2026-...' }
 *   }
 *
 * Every state change writes a row to `meta_channel_consent_events` for audit.
 * The MetaChannelConsentEvent table is append-only.
 *
 * Methods:
 *   recordOptIn({ shopId, channelId, customerId, platform, source, metadata })
 *   recordOptOut({ shopId, channelId, customerId, platform, source, metadata })
 *   recordInbound({ shopId, channelId, customerId, platform, metadata })  — implicit opt-in + last_inbound_at bump
 *   recordDeauthorize({ shopId, channelId, customerId, platform, metadata })
 *   recordDataDeletion({ shopId, channelId, customerId, platform, metadata })
 *   hasConsent({ customer, platform })                  — bool, used by policy rules
 *   getLastInboundAt({ customer, platform })            — Date|null, used by 24h-window rule
 *
 * The hasConsent and getLastInboundAt readers take a Customer entity directly
 * (already-loaded) to keep policy evaluation a pure synchronous lookup.
 */

'use strict';

const { createLogger } = require('../../utils/structured-logger');
const { sequelize } = require('../../utils/database/database-setup');
const Customer = require('../customer/customer.entity');
const MetaChannelConsentEvent = require('../channel-providers/meta-channel-consent-event.entity');

const logger = createLogger('ConsentService');

const STOP_KEYWORDS = [
    'stop',           // EN
    'stop koro',      // Banglish
    'unsubscribe',    // EN
    'ar na',          // Banglish — "no more"
    'bondo koro',     // Banglish — "stop it"
    'band koro',      // Banglish spelling variant
    'বন্ধ',          // BN — bondho ("stop")
    'বন্ধ করো',      // BN — bondho koro ("stop it")
    'আর না',         // BN — ar na ("no more")
    'থামুন',         // BN — thamun ("stop")
    'স্টপ',          // BN transliteration
];

const META_CONSENT_PLATFORMS = new Set(['facebook', 'messenger', 'instagram']);
const CONSENT_ERROR_CODES = Object.freeze({
    CONTEXT_UNAVAILABLE: 'CONSENT_CONTEXT_UNAVAILABLE',
    CUSTOMER_CONTEXT_UNAVAILABLE: 'CUSTOMER_CONTEXT_UNAVAILABLE',
    STATE_UNAVAILABLE: 'CONSENT_STATE_UNAVAILABLE',
});

function normalizePlatform(platform) {
    return platform === 'messenger' ? 'facebook' : platform;
}

function makeConsentError(code, message) {
    const error = new Error(message);
    error.name = 'ConsentStateError';
    error.code = code;
    error.retryable = true;
    return error;
}

function hasRequiredContextValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function isStopKeyword(text) {
    if (!text || typeof text !== 'string') return false;
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    return STOP_KEYWORDS.some(k => normalized === k.toLowerCase());
}

function ensurePlatformShape(consent, platform, patch = {}) {
    const prev = (consent && consent[platform]) || {};
    return {
        ...consent,
        [platform]: {
            opted_in: prev.opted_in ?? false,
            opted_out_at: prev.opted_out_at ?? null,
            last_inbound_at: prev.last_inbound_at ?? null,
            ...patch,
        }
    };
}

class ConsentService {

    isStopKeyword(text) {
        return isStopKeyword(text);
    }

    /**
     * Returns true if the customer can be messaged on this platform.
     * Phase 5: reads exclusively from messaging_consent JSONB.
     */
    hasConsent({ customer, platform }) {
        if (!customer) return false;
        const pf = normalizePlatform(platform);

        // Consent is required for Meta customer messaging. Legacy non-Meta
        // callers retain their previous behavior because they do not use the
        // Meta consent JSON shape.
        if (!META_CONSENT_PLATFORMS.has(pf)) return true;

        const channelConsent = customer.messaging_consent?.[pf];
        return channelConsent?.opted_in === true && !channelConsent?.opted_out_at;
    }

    getLastInboundAt({ customer, platform }) {
        const pf = normalizePlatform(platform);
        const v = customer?.messaging_consent?.[pf]?.last_inbound_at;
        return v ? new Date(v) : null;
    }

    async _withCustomerTransaction(work) {
        if (sequelize?.getDialect?.() === 'postgres' && typeof sequelize.transaction === 'function') {
            return sequelize.transaction(work);
        }
        return work(null);
    }

    async _findRequiredCustomer({ shopId, channelId, customerId, platform, transaction = null }) {
        const pf = normalizePlatform(platform);
        if (![shopId, channelId, customerId, platform].every(hasRequiredContextValue)) {
            throw makeConsentError(
                CONSENT_ERROR_CODES.CONTEXT_UNAVAILABLE,
                'Consent bookkeeping context is required',
            );
        }

        let customer;
        try {
            customer = transaction
                ? await Customer.findByPk(customerId, { transaction, lock: transaction.LOCK?.UPDATE })
                : await Customer.findByPk(customerId);
        } catch (_) {
            throw makeConsentError(
                CONSENT_ERROR_CODES.STATE_UNAVAILABLE,
                'Consent state is temporarily unavailable',
            );
        }

        if (!customer) {
            logger.warn('ConsentService: customer not found', { customerId, platform });
            throw makeConsentError(
                CONSENT_ERROR_CODES.CUSTOMER_CONTEXT_UNAVAILABLE,
                'Consent customer context is unavailable',
            );
        }

        const expectedChannelType = pf === 'facebook' ? 'messenger' : pf;
        if ((customer.shop_id != null && String(customer.shop_id) !== String(shopId))
            || (customer.channel_type != null && customer.channel_type !== expectedChannelType)
            || (customer.meta_channel_id != null && String(customer.meta_channel_id) !== String(channelId))) {
            logger.warn('ConsentService: customer context does not match the requested shop/channel', {
                customerId,
                shopId,
                channelId,
                platform: pf,
            });
            throw makeConsentError(
                CONSENT_ERROR_CODES.CUSTOMER_CONTEXT_UNAVAILABLE,
                'Consent customer context is unavailable',
            );
        }

        return customer;
    }

    async _saveCustomer(customer, transaction = null) {
        try {
            if (transaction) await customer.save({ transaction });
            else await customer.save();
        } catch (_) {
            throw makeConsentError(
                CONSENT_ERROR_CODES.STATE_UNAVAILABLE,
                'Consent state could not be persisted',
            );
        }
    }

    async _writeAuditEvent({
        shopId,
        channelId,
        customerId,
        event,
        source,
        metadata = null,
        transaction = null,
        strict = false,
    }) {
        try {
            const payload = {
                shop_id: shopId,
                channel_id: channelId,
                customer_id: customerId,
                event,
                source,
                metadata,
            };
            if (transaction) {
                await MetaChannelConsentEvent.create(payload, { transaction });
            } else {
                await MetaChannelConsentEvent.create(payload);
            }
        } catch (err) {
            logger.error('ConsentService: failed to write audit event', {
                error: err.message, shopId, channelId, customerId, event, source,
            });
            // Inbound message processing remains best-effort, but compliance
            // callbacks opt into strict mode so they can never report success
            // when the required audit record was not persisted.
            if (strict) throw err;
        }
    }

    /**
     * Mark customer as opted in for the given platform.
     * Does NOT clear opted_out_at — re-opt-in is an explicit business decision
     * the admin must perform if needed.
     */
    async recordOptIn({ shopId, channelId, customerId, platform, source = 'webhook_messaging_optins', metadata = null }) {
        const pf = normalizePlatform(platform);
        const customer = await this._withCustomerTransaction(async (transaction) => {
            const lockedCustomer = await this._findRequiredCustomer({ shopId, channelId, customerId, platform: pf, transaction });
            const next = ensurePlatformShape(lockedCustomer.messaging_consent, pf, {
                opted_in: true,
                // re-opt-in implies the prior opt-out is lifted only when source = admin
                opted_out_at: source === 'admin' ? null : (lockedCustomer.messaging_consent?.[pf]?.opted_out_at ?? null),
            });
            lockedCustomer.messaging_consent = next;
            lockedCustomer.changed('messaging_consent', true);
            await this._saveCustomer(lockedCustomer, transaction);

            const eventName = source === 'webhook_messaging_optins' ? 'OPT_IN_EXPLICIT' : 'OPT_IN_IMPLICIT';
            await this._writeAuditEvent({
                shopId, channelId, customerId, event: eventName, source, metadata, transaction,
            });
            return lockedCustomer;
        });

        logger.info('ConsentService.recordOptIn', { shopId, customerId, platform: pf, source });
        return customer;
    }

    /**
     * Mark customer as opted out for the given platform. Idempotent — only the
     * first opt-out timestamp is preserved.
     */
    async recordOptOut({ shopId, channelId, customerId, platform, source = 'keyword_stop', metadata = null }) {
        const pf = normalizePlatform(platform);
        const customer = await this._withCustomerTransaction(async (transaction) => {
            const lockedCustomer = await this._findRequiredCustomer({ shopId, channelId, customerId, platform: pf, transaction });
            const prev = lockedCustomer.messaging_consent?.[pf] || {};
            const next = ensurePlatformShape(lockedCustomer.messaging_consent, pf, {
                opted_in: false,
                opted_out_at: prev.opted_out_at || new Date().toISOString(),
            });
            lockedCustomer.messaging_consent = next;
            lockedCustomer.changed('messaging_consent', true);
            await this._saveCustomer(lockedCustomer, transaction);

            await this._writeAuditEvent({
                shopId, channelId, customerId, event: 'OPT_OUT', source, metadata, transaction,
            });
            return lockedCustomer;
        });

        logger.info('ConsentService.recordOptOut', { shopId, customerId, platform: pf, source });
        return customer;
    }

    /**
     * Bump last_inbound_at + flip opted_in true (implicit Messenger consent).
     * Called from the inbound message webhook on EVERY message — fast path.
     */
    async recordInbound({ shopId, channelId, customerId, platform, metadata = null }) {
        const pf = normalizePlatform(platform);
        const customer = await this._withCustomerTransaction(async (transaction) => {
            const lockedCustomer = await this._findRequiredCustomer({ shopId, channelId, customerId, platform: pf, transaction });
            const prev = lockedCustomer.messaging_consent?.[pf] || {};
            const next = ensurePlatformShape(lockedCustomer.messaging_consent, pf, {
                // An inbound message after an opt-out does NOT re-grant consent —
                // the customer must explicitly opt back in.
                opted_in: prev.opted_in === true || !prev.opted_out_at,
                last_inbound_at: new Date().toISOString(),
            });
            lockedCustomer.messaging_consent = next;
            lockedCustomer.changed('messaging_consent', true);
            await this._saveCustomer(lockedCustomer, transaction);

            // No audit row for every inbound (would balloon the table); only
            // emit one when this is the first-ever opt-in.
            if (!prev.opted_in && !prev.opted_out_at) {
                await this._writeAuditEvent({
                    shopId, channelId, customerId,
                    event: 'OPT_IN_IMPLICIT', source: 'message', metadata, transaction,
                });
                try {
                    require('../analytics/funnel-events.service')
                        .recordFunnelEvent({
                            event: 'first_inbound_message',
                            shopId,
                            onceKey: shopId,
                            metadata: { channel_id: channelId, customer_id: customerId, platform: pf },
                        })
                        .catch(() => {});
                } catch (_) { /* funnel logging must never block inbound */ }
            }
            return lockedCustomer;
        });
        return customer;
    }

    async recordDeauthorize({
        shopId,
        channelId,
        customerId,
        platform,
        metadata = null,
        transaction = null,
        strictAudit = false,
    }) {
        return this._terminalEvent({
            shopId, channelId, customerId, platform,
            event: 'DEAUTHORIZED', source: 'meta_callback', metadata,
            transaction, strictAudit,
        });
    }

    async recordDataDeletion({
        shopId,
        channelId,
        customerId,
        platform,
        metadata = null,
        transaction = null,
        strictAudit = false,
    }) {
        return this._terminalEvent({
            shopId, channelId, customerId, platform,
            event: 'DATA_DELETED', source: 'meta_callback', metadata,
            transaction, strictAudit,
        });
    }

    async _terminalEvent({
        shopId,
        channelId,
        customerId,
        platform,
        event,
        source,
        metadata,
        transaction = null,
        strictAudit = false,
    }) {
        if (!customerId || !platform) return null;
        const customer = await Customer.findByPk(customerId, { transaction });
        if (!customer) return null;

        const next = ensurePlatformShape(customer.messaging_consent, platform, {
            opted_in: false,
            opted_out_at: customer.messaging_consent?.[platform]?.opted_out_at || new Date().toISOString(),
        });
        customer.messaging_consent = next;
        customer.changed('messaging_consent', true);
        await customer.save({ transaction });

        await this._writeAuditEvent({
            shopId,
            channelId,
            customerId,
            event,
            source,
            metadata,
            transaction,
            strict: strictAudit,
        });
        return customer;
    }
}

module.exports = new ConsentService();
module.exports.STOP_KEYWORDS = STOP_KEYWORDS;
module.exports.isStopKeyword = isStopKeyword;
module.exports.CONSENT_ERROR_CODES = CONSENT_ERROR_CODES;
