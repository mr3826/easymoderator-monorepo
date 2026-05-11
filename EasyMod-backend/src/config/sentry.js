'use strict';

const { createLogger } = require('../utils/structured-logger');
const logger = createLogger('Sentry');

const initSentry = (app) => {
    if (!process.env.SENTRY_DSN) {
        logger.info('[Sentry] SENTRY_DSN not set — error tracking disabled');
        return null;
    }

    const Sentry = require('@sentry/node');

    try {
        const { nodeProfilingIntegration } = require('@sentry/profiling-node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
            integrations: [nodeProfilingIntegration()],
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
            profilesSampleRate: 0.1,
        });
    } catch {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',
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

module.exports = { initSentry, sentryCaptureException };
