'use strict';

/**
 * Ops Alert Service
 *
 * Stub implementation. Sends escalation alerts to the ops team when
 * the guardrail service flags a HIGH-severity violation in an AI response.
 *
 * Production integration: connect to n8n webhook, Slack API, or
 * an internal notification queue. Replace `sendEscalationAlert` body below.
 */

const { createLogger } = require('../../utils/structured-logger');
const logger = createLogger('OpsAlert');

class OpsAlertService {
    /**
     * Send an escalation alert to the ops team.
     *
     * @param {object} alert
     * @param {string} alert.type - Alert type (e.g., 'GUARDRAIL_ESCALATION')
     * @param {string} alert.conversationId
     * @param {string} alert.shopId
     * @param {Array}  alert.violations - Guardrail violations
     * @param {string} alert.customerMessage
     * @param {string} alert.aiResponse
     * @param {'HIGH'|'MEDIUM'} alert.priority
     */
    async sendEscalationAlert(alert) {
        // Structured log is the production-ready minimum — alerts appear in Cloud Run logs
        // and can be routed via Cloud Logging sinks to Pub/Sub → n8n or Slack.
        logger.warn('GUARDRAIL ESCALATION — human review required', {
            type: alert.type,
            conversationId: alert.conversationId,
            shopId: alert.shopId,
            priority: alert.priority,
            violationTypes: alert.violations?.map(v => v.type),
            // Do NOT log customerMessage or aiResponse — may contain PII
        });

        const webhookUrl = process.env.OPS_ESCALATION_WEBHOOK_URL;
        if (webhookUrl) {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: alert.type,
                    conversationId: alert.conversationId,
                    shopId: alert.shopId,
                    priority: alert.priority,
                    violationTypes: alert.violations?.map(v => v.type),
                }),
            }).catch(err => logger.error('ops-alert webhook delivery failed', { err: err.message }));
        }
    }
}

module.exports = new OpsAlertService();
