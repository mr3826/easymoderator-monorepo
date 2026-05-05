'use strict';

// TODO: When ready to activate Sentry:
//   1. npm install --save @sentry/node @sentry/profiling-node
//   2. Set SENTRY_DSN in .env and GCP Secret Manager (secret: easymod-SENTRY_DSN)
//   3. Uncomment the Sentry.init block and the handler registrations in initSentry()
//   4. Uncomment Sentry.captureException in sentryCaptureException()

const { createLogger } = require('../utils/structured-logger');
const logger = createLogger('Sentry');

const initSentry = (app) => {
    if (!process.env.SENTRY_DSN) {
        logger.info('[Sentry] SENTRY_DSN not set — error tracking disabled');
        return null;
    }

    // TODO: Uncomment when DSN is ready
    // const Sentry = require('@sentry/node');
    // const { nodeProfilingIntegration } = require('@sentry/profiling-node');
    // Sentry.init({
    //     dsn: process.env.SENTRY_DSN,
    //     environment: process.env.NODE_ENV || 'development',
    //     integrations: [nodeProfilingIntegration()],
    //     tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    //     profilesSampleRate: 0.1,
    // });
    // app.use(Sentry.Handlers.requestHandler());
    // app.use(Sentry.Handlers.tracingHandler());
    // return Sentry;

    return null;
};

// Call in the global error handler to forward unhandled errors to Sentry
const sentryCaptureException = (err, context = {}) => {
    if (!process.env.SENTRY_DSN) return;

    // TODO: Uncomment when DSN is ready
    // const Sentry = require('@sentry/node');
    // Sentry.captureException(err, { extra: context });
};

module.exports = { initSentry, sentryCaptureException };
