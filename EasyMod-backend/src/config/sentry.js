'use strict';

const { createLogger } = require('../utils/structured-logger');
const logger = createLogger('Sentry');

const initSentry = (app) => {
    if (!process.env.SENTRY_DSN) {
        logger.info('[Sentry] SENTRY_DSN not set — error tracking disabled');
        return null;
    }

    const Sentry = require('@sentry/node');

    // Tie every event to the exact deploy. GIT_SHA is baked into the image by the
    // Dockerfile (ARG GIT_SHA → ENV GIT_SHA); BUILD_TIME is the image dist marker.
    const release = process.env.GIT_SHA || process.env.APP_VERSION || undefined;
    const dist = process.env.BUILD_TIME || undefined;

    try {
        const { nodeProfilingIntegration } = require('@sentry/profiling-node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
            release,
            dist,
            integrations: [nodeProfilingIntegration()],
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
            profilesSampleRate: 0.1,
        });
    } catch {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
            release,
            dist,
            tracesSampleRate: 0.1,
        });
    }

    // Sentry v8+ removed Handlers — use setupExpressErrorHandler after routes
    // requestHandler/tracingHandler are no longer needed
    if (Sentry.setupExpressErrorHandler) {
        // called after routes in app.js if needed
    } else if (Sentry.Handlers) {
        app.use(Sentry.Handlers.requestHandler());
        app.use(Sentry.Handlers.tracingHandler());
    }

    logger.info('[Sentry] Initialized');
    return Sentry;
};

const sentryCaptureException = (err, context = {}) => {
    if (!process.env.SENTRY_DSN) return;
    const Sentry = require('@sentry/node');
    Sentry.captureException(err, { extra: context });
};

/**
 * Capture a message-level event (no Error object) — used for operational
 * alerts such as a stale auto-reply pipeline or a non-empty DLQ, where there
 * is no thrown exception but the condition still needs to page someone.
 */
const sentryCaptureMessage = (message, { level = 'error', extra = {} } = {}) => {
    if (!process.env.SENTRY_DSN) return;
    const Sentry = require('@sentry/node');
    Sentry.captureMessage(message, { level, extra });
};

module.exports = { initSentry, sentryCaptureException, sentryCaptureMessage };
