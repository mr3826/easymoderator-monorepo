'use strict';

/**
 * ADR M-004 — token issuance for native (body-token) auth.
 *
 * Deliberately NOT an edit to utils/jwt.util.js: that file's
 * generateAccessToken/generateRefreshToken always sign with
 * config.jwtAccessExpiresIn/jwtRefreshExpiresIn (the web 1d/30d lifetimes),
 * and native needs a fixed 15-minute access-token lifetime plus a `sid`
 * claim no web token carries. Signing directly here with the SAME secrets
 * and algorithm means the existing, unmodified `verifyAccessToken` in
 * jwt.util.js decodes native tokens with zero changes — it only checks
 * signature + expiry, never how the token was produced.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../../config/config');

const NATIVE_ACCESS_TOKEN_TTL = '15m';

/**
 * Sign a 15-minute native access token carrying a `sid` claim.
 */
const signNativeAccessToken = ({ userId, email, shopId, tokenVersion, mfaVerified, sid }) =>
    jwt.sign(
        {
            userId,
            email,
            shopId,
            tokenVersion,
            mfaVerified: mfaVerified === true,
            sid,
        },
        config.jwtAccessSecret,
        { algorithm: 'HS256', expiresIn: NATIVE_ACCESS_TOKEN_TTL },
    );

/**
 * Sign a rotating native refresh token. Carries `generation` so a session
 * row can distinguish "the current token" from "a token that was valid N
 * rotations ago" — see session.entity.js for why this is the chosen lineage
 * strategy.
 */
const signNativeRefreshToken = ({ userId, sid, tokenVersion, mfaVerified, generation }) =>
    jwt.sign(
        {
            userId,
            sid,
            tokenVersion,
            mfaVerified: mfaVerified === true,
            generation,
        },
        config.jwtRefreshSecret,
        { algorithm: 'HS256', expiresIn: config.jwtRefreshExpiresIn },
    );

/**
 * Verify a native refresh token. Throws on bad signature/expiry — callers
 * must treat that as a plain invalid-token 401, NOT as reuse: an
 * unsigned/forged token proves nothing about any session's lineage.
 */
const verifyNativeRefreshToken = (token) =>
    jwt.verify(token, config.jwtRefreshSecret, { algorithms: ['HS256'] });

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
    NATIVE_ACCESS_TOKEN_TTL,
    signNativeAccessToken,
    signNativeRefreshToken,
    verifyNativeRefreshToken,
    hashToken,
};
