'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../../config/config');
const metaComplianceService = require('./meta-compliance.service');
const metaAuthorizationRecovery = require('../channel-providers/meta-authorization-recovery.service');
const { createLogger } = require('../../utils/structured-logger');
const { getOrigins } = require('../../config/origins');

const logger = createLogger('MetaWebhookGdpr');
const router = express.Router();
const MAX_SIGNED_REQUEST_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function decodeBase64Url(value) {
    return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseSignedRequest(signedRequest, appSecret, now = Date.now()) {
    try {
        if (typeof signedRequest !== 'string' || !appSecret) return null;
        const parts = signedRequest.split('.');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

        const signature = decodeBase64Url(parts[0]);
        const expected = crypto.createHmac('sha256', appSecret).update(parts[1]).digest();
        if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
            return null;
        }

        const payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'));
        if (String(payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
        if (!payload.user_id || typeof payload.user_id !== 'string') return null;

        const issuedAtMs = Number(payload.issued_at) * 1000;
        if (!Number.isFinite(issuedAtMs)) return null;
        if (issuedAtMs > now + MAX_CLOCK_SKEW_MS) return null;
        if (now - issuedAtMs > MAX_SIGNED_REQUEST_AGE_MS) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

function appSecret() {
    return config.metaAppSecret || process.env.META_APP_SECRET;
}

function publicBaseUrl() {
    return getOrigins().api;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderDeletionStatus(code, status) {
    const state = String(status?.status || 'pending').replace(/_/g, ' ');
    const retryMessage = status?.retryable
        ? '<p>This request requires another processing attempt. Contact privacy@easymod.tech if it remains unresolved.</p>'
        : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EasyModerator Data Deletion Status</title></head><body><main><h1>EasyModerator Data Deletion Status</h1><p>Confirmation code: <code>${escapeHtml(code)}</code></p><p>Status: <strong>${escapeHtml(state)}</strong></p>${retryMessage}<p>For assistance, email <a href="mailto:privacy@easymod.tech">privacy@easymod.tech</a>.</p></main></body></html>`;
}

router.get('/data-deletion', (req, res) => {
    res.json({
        message: 'EasyModerator Facebook Data Deletion',
        instructions: [
            'Remove EasyModerator from Facebook Settings > Apps and Websites.',
            'Meta will send a signed deletion callback and return an opaque confirmation code.',
            'Open the returned status URL to see pending, identity-not-resolved, completed, or failed status.',
            'For manual assistance, email privacy@easymod.tech.',
        ],
        contact: 'privacy@easymod.tech',
    });
});

router.get('/data-deletion/status/:confirmationCode', async (req, res) => {
    try {
        const status = await metaComplianceService.getDeletionStatus(
            req.params.confirmationCode,
        );
        if (!status) {
            if (req.get('accept')?.includes('text/html')) {
                return res.status(404).type('html').send(renderDeletionStatus(req.params.confirmationCode, {
                    status: 'not found',
                    retryable: false,
                }));
            }
            return res.status(404).json({ error: 'Deletion request not found' });
        }
        if (req.get('accept')?.includes('text/html')) {
            return res.status(200).type('html').send(renderDeletionStatus(req.params.confirmationCode, status));
        }
        return res.status(200).json(status);
    } catch (err) {
        logger.error('Data deletion status lookup failed', { error: err.message });
        return res.status(500).json({ error: 'Deletion status is temporarily unavailable' });
    }
});

router.post('/data-deletion', express.urlencoded({ extended: false }), async (req, res) => {
    const signedRequest = req.body?.signed_request;
    if (!signedRequest) return res.status(400).json({ error: 'Missing signed_request' });

    const secret = appSecret();
    if (!secret) {
        logger.error('Data deletion callback rejected: META_APP_SECRET is unavailable');
        return res.status(503).json({ error: 'Data deletion is temporarily unavailable' });
    }

    const payload = parseSignedRequest(signedRequest, secret);
    if (!payload) return res.status(403).json({ error: 'Invalid or expired signed_request' });

    try {
        const result = await metaComplianceService.processDeletionRequest({
            signedRequest,
            appScopedUserId: payload.user_id,
            appSecret: secret,
        });
        return res.status(200).json({
            url: `${publicBaseUrl()}/webhooks/meta/data-deletion/status/${result.confirmationCode}`,
            confirmation_code: result.confirmationCode,
        });
    } catch (err) {
        logger.error('Data deletion processing failed', {
            failureCode: err.code || 'DELETION_PROCESSING_FAILED',
        });
        return res.status(500).json({
            error: 'Data deletion did not complete; the request is recorded for retry',
        });
    }
});

router.post('/deauthorize', express.urlencoded({ extended: false }), async (req, res) => {
    const signedRequest = req.body?.signed_request;
    if (!signedRequest) return res.status(400).json({ error: 'Missing signed_request' });

    const secret = appSecret();
    if (!secret) {
        logger.error('Deauthorization callback rejected: META_APP_SECRET is unavailable');
        return res.status(503).json({ error: 'Deauthorization is temporarily unavailable' });
    }
    const payload = parseSignedRequest(signedRequest, secret);
    if (!payload) return res.status(403).json({ error: 'Invalid or expired signed_request' });

    try {
        await metaAuthorizationRecovery.processDeauthorization(payload.user_id);
        return res.sendStatus(200);
    } catch (err) {
        logger.error('Meta deauthorization failed', {
            failureCode: err.code || 'DEAUTHORIZATION_FAILED',
        });
        return res.sendStatus(500);
    }
});

module.exports = router;
module.exports._private = {
    MAX_CLOCK_SKEW_MS,
    MAX_SIGNED_REQUEST_AGE_MS,
    parseSignedRequest,
};
