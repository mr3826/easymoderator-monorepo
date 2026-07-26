'use strict';

/**
 * Operational alerting — one entry point that fans a single alert out to every
 * configured sink (Slack webhook + Sentry) and always logs to the console.
 *
 * Why this exists: the most damaging incidents in this product have been SILENT
 * (a job that never enqueued, a reply that returned sent:false, a job that died
 * into the DLQ with only a console.error). Anything that means a customer did
 * NOT get a reply must page a human, not just print a line nobody reads.
 *
 * Sinks are best-effort and independent: a Slack outage must not suppress the
 * Sentry event, and neither must throw into the caller's hot path.
 *
 * Throttling: opsAlert is safe to call from per-message hot paths. The console
 * line is always written (forensics), but the external sinks (Slack + Sentry)
 * are de-duplicated per-title within OPS_ALERT_THROTTLE_MS so one broken deploy
 * affecting every message pages once, not thousands of times.
 *
 * Config:
 *   SLACK_ALERT_WEBHOOK_URL — incoming-webhook URL (optional; skipped if unset)
 *   SENTRY_DSN              — enables the Sentry sink (handled in config/sentry)
 *   OPS_ALERT_THROTTLE_MS   — per-title external-sink dedup window (default 5m)
 */

const { sentryCaptureMessage } = require('../config/sentry');

const num = (envVal, fallback) => {
    const n = parseInt(envVal, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const THROTTLE_MS = num(process.env.OPS_ALERT_THROTTLE_MS, 5 * 60 * 1000);
const lastSentByTitle = new Map();

// Returns true if this title's external sinks should fire now (and records it).
function shouldFanOut(title, now) {
    if (THROTTLE_MS === 0) return true;
    const last = lastSentByTitle.get(title) || 0;
    if (now - last < THROTTLE_MS) return false;
    lastSentByTitle.set(title, now);
    return true;
}

async function sendSlack(text) {
    const url = process.env.SLACK_ALERT_WEBHOOK_URL;
    if (!url) return false;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        return true;
    } catch (_) {
        return false; // never let an alert-sink failure bubble into the caller
    }
}

/**
 * Fire an operational alert.
 * @param {string} title  short, greppable headline (also the throttle key)
 * @param {object} [opts]
 * @param {string} [opts.detail]  human-readable context (multi-line ok)
 * @param {'warning'|'error'} [opts.level]  severity (default 'error')
 * @param {object} [opts.context]  structured extra data for Sentry
 */
async function opsAlert(title, { detail = '', level = 'error', context = {} } = {}) {
    const line = detail ? `${title} — ${detail}` : title;
    if (level === 'error') console.error(`[OPS-ALERT] ${line}`);
    else console.warn(`[OPS-ALERT] ${line}`);

    if (!shouldFanOut(title, Date.now())) return;

    try {
        sentryCaptureMessage(`[OPS] ${title}`, { level, extra: { detail, ...context } });
    } catch (_) { /* sink failure must not propagate */ }

    const emoji = level === 'error' ? ':rotating_light:' : ':warning:';
    await sendSlack(detail ? `${emoji} *${title}*\n${detail}` : `${emoji} *${title}*`);
}

/**
 * Which alert sinks are configured — booleans only, never the DSN or URL.
 * Used by the admin test-alert endpoint and to answer launch gate 8.
 */
function describeAlertSinks() {
    return {
        slackConfigured: Boolean(process.env.SLACK_ALERT_WEBHOOK_URL),
        sentryConfigured: Boolean(process.env.SENTRY_DSN),
    };
}

/**
 * Fire a deliberate, PII-free test alert and report what happened per sink.
 *
 * Bypasses the per-title throttle so an operator running this twice actually
 * sees two events. Slack acceptance is observable (the webhook POST resolves);
 * Sentry send is fire-and-forget, so it is reported as "attempted" when the DSN
 * is configured. The caller must still confirm the message arrived on a device
 * they watch — configuration alone does not close launch gate 8.
 *
 * @param {object} [opts]
 * @param {string} [opts.actorLabel] non-PII marker (e.g. an admin user id) for traceability
 * @returns {Promise<{slackConfigured:boolean, sentryConfigured:boolean, slackAccepted:boolean, sentryAttempted:boolean, anySinkConfigured:boolean}>}
 */
async function sendTestAlert({ actorLabel = 'unknown' } = {}) {
    const sinks = describeAlertSinks();
    const title = 'EasyModerator ops alert test';
    const detail = `Manual alerting self-test. actor=${actorLabel}. `
        + 'If you can read this, this sink is delivering. No customer data is included.';

    // Always log for forensics.
    console.warn(`[OPS-ALERT] ${title} — ${detail}`);

    let sentryAttempted = false;
    if (sinks.sentryConfigured) {
        try {
            sentryCaptureMessage(`[OPS] ${title}`, { level: 'warning', extra: { detail } });
            sentryAttempted = true;
        } catch (_) { /* never propagate */ }
    }

    let slackAccepted = false;
    if (sinks.slackConfigured) {
        slackAccepted = await sendSlack(`:test_tube: *${title}*\n${detail}`);
    }

    return {
        ...sinks,
        slackAccepted,
        sentryAttempted,
        anySinkConfigured: sinks.slackConfigured || sinks.sentryConfigured,
    };
}

module.exports = { opsAlert, sendSlack, describeAlertSinks, sendTestAlert };
