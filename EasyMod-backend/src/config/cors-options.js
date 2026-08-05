'use strict';

const PUBLIC_CROSS_ORIGIN_PATHS = new Set([
    '/api/public/live-stats',
    '/api/analytics/funnel',
    '/api/partner/apply',
]);

function buildCorsOptions(req, config) {
    const isPublicSurface = PUBLIC_CROSS_ORIGIN_PATHS.has(req.path);
    const routeOrigins = isPublicSurface
        ? [config.origins.marketing, config.origins.app]
        : (config.corsOrigins || []);

    return {
        origin(origin, callback) {
            if (!origin || routeOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: !isPublicSurface,
    };
}

module.exports = { buildCorsOptions, PUBLIC_CROSS_ORIGIN_PATHS };
