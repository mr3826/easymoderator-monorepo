'use strict';

/**
 * ADR M-005: reads the mobile client's attribution header, e.g.
 * `X-EM-Client: android/1.2.0`, and exposes it as `req.mobileClient` for any
 * handler that writes an audit row (`AuditService.logOperation`'s
 * `metadata.source: 'MOBILE'`).
 *
 * Fully inert for every existing (web) request: the header is never sent by
 * the web app, so req.mobileClient is always null for it today, identical to
 * not having this middleware at all.
 */
const mobileClientContext = (req, _res, next) => {
    const header = req.get('X-EM-Client');
    req.mobileClient = typeof header === 'string' && header.trim() !== '' ? header.trim() : null;
    next();
};

module.exports = { mobileClientContext };
