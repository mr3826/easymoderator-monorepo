/**
 * PolicyEngine — mandatory outbound gate.
 *
 * Every Meta outbound message (AI reply, payment confirmation, delivery update,
 * comment-to-DM, owner notification echo) MUST pass through evaluateOutbound()
 * before the actual Graph API call. Defense-in-depth: meta-send.service ALSO
 * calls evaluatePreFlight() so an upstream bug bypassing the worker still
 * cannot send to opted-out users.
 *
 * Pipeline contract:
 *   Each rule returns { allow, reason, transform?, augment?, retryAfterMs? }
 *   Engine merges augment into a running ctx so downstream rules see it.
 *   Engine merges transforms back into `message` before subsequent rules.
 *   First allow=false short-circuits — remaining rules are NOT evaluated.
 *
 * Output decision:
 *   {
 *     allow:        boolean,           // final verdict
 *     reason:       string,            // first deny's reason, or 'OK'
 *     transform:    NormalizedMessage, // final message (possibly sanitized)
 *     augment:      { message_tag?, retry_after_ms?, within_window?, ... },
 *     retryAfterMs: number?,           // surfaced from rateLimit
 *     ruleResults:  Array,             // per-rule [{ name, allow, reason }]
 *     policyVersion,
 *     decisionId:   uuid (set after persist),
 *     loggedAt:     Date,
 *   }
 *
 * Persistence: a row is ALWAYS written to policy_decisions (allow or deny).
 * The raw message text is NOT stored — only sha256(text) for forensic linkage.
 */

'use strict';

const crypto = require('crypto');
const rules = require('./policy.rules');
const PolicyDecision = require('./policy-decision.entity');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('PolicyEngine');

const POLICY_VERSION = '1.0.0';

function hashMessage(text) {
    if (!text || typeof text !== 'string') return null;
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 64);
}

class PolicyEngine {

    get policyVersion() { return POLICY_VERSION; }

    /**
     * Evaluate an outbound NormalizedMessage against the rule pipeline.
     *
     * @param {NormalizedMessage} message
     * @param {object} ctx
     * @param {string} ctx.shopId
     * @param {Customer} [ctx.customer]
     * @param {'facebook'|'instagram'} ctx.platform
     * @param {MetaChannel} [ctx.channel]
     * @param {MetaChannelSettings|object} [ctx.settings]
     * @param {string} [ctx.conversationId]
     * @param {object} [ctx.options]            - { skipPersist: bool, preFlight: bool }
     * @returns {Promise<PolicyDecision>}
     */
    async evaluateOutbound(message, ctx = {}) {
        const startedAt = Date.now();
        const options = ctx.options || {};
        const ruleResults = [];
        let currentMessage = message ? { ...message } : { text: '' };
        let runningAugment = {};
        let transformApplied = false;
        let firstDeny = null;
        let retryAfterMs;

        for (const rule of rules) {
            let result;
            try {
                result = await rule.evaluate(currentMessage, { ...ctx, runningAugment });
            } catch (err) {
                logger.error('PolicyEngine: rule threw — fail-closed', { rule: rule.name, error: err.message });
                result = { allow: false, reason: 'RULE_ERROR' };
            }

            ruleResults.push({ name: rule.name, allow: result.allow, reason: result.reason });

            if (result.transform) {
                currentMessage = result.transform;
                transformApplied = true;
            }
            if (result.augment) {
                runningAugment = { ...runningAugment, ...result.augment };
            }
            if (result.retryAfterMs && retryAfterMs == null) {
                retryAfterMs = result.retryAfterMs;
            }
            if (!result.allow) {
                firstDeny = { rule: rule.name, reason: result.reason };
                break;  // short-circuit
            }
        }

        const allow = !firstDeny;
        const decision = {
            allow,
            reason: allow ? 'OK' : firstDeny.reason,
            transform: currentMessage,
            augment: runningAugment,
            retryAfterMs,
            ruleResults,
            policyVersion: POLICY_VERSION,
            transformApplied,
            evaluatedInMs: Date.now() - startedAt,
            loggedAt: new Date(),
        };

        if (!options.skipPersist) {
            try {
                const row = await PolicyDecision.create({
                    shop_id: ctx.shopId,
                    channel_id: ctx.channel?.id ?? null,
                    conversation_id: ctx.conversationId ?? null,
                    customer_id: ctx.customer?.id ?? null,
                    platform: ctx.platform || 'facebook',
                    direction: 'outbound',
                    allow: decision.allow,
                    reason: decision.reason,
                    rule_results: ruleResults,
                    transform_applied: transformApplied,
                    augment: runningAugment,
                    policy_version: POLICY_VERSION,
                    message_hash: hashMessage(currentMessage?.text),
                });
                decision.decisionId = row.id;
            } catch (err) {
                // Persistence failure must NOT block the send. Log loudly.
                // structured-logger.error() takes the Error as its second
                // positional arg — wrapping it in {error: ...} masks it to {}.
                logger.error('PolicyEngine: failed to persist decision', err);
            }
        }

        if (!allow) {
            logger.warn('PolicyEngine: outbound denied', {
                shopId: ctx.shopId, platform: ctx.platform,
                reason: decision.reason, rule: firstDeny.rule,
            });
        }
        return decision;
    }

    /**
     * Defense-in-depth check used by meta-send.service before the actual HTTP call.
     * Skips persistence (the worker already wrote a row); only purpose is to catch
     * any code path that bypassed evaluateOutbound. If this denies, the send is
     * dropped and a warning logged — no policy_decisions row is written here to
     * avoid duplicate rows for the same logical send.
     */
    async evaluatePreFlight(message, ctx = {}) {
        return this.evaluateOutbound(message, { ...ctx, options: { ...ctx.options, skipPersist: true, preFlight: true } });
    }
}

module.exports = new PolicyEngine();
module.exports.POLICY_VERSION = POLICY_VERSION;
module.exports.hashMessage = hashMessage;
