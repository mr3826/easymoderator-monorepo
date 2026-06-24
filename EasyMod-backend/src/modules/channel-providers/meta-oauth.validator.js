/**
 * meta-oauth.validator.js
 *
 * Joi schemas for the canonical /api/channels/meta/oauth/* surface.
 *
 * The legacy validators in modules/channel/channel.validator.js still cover the
 * old /api/channels/oauth/* surface (kept alive during the dual-write window).
 * These schemas mirror them in shape but use platform-first naming (asset, not
 * page) so they extend cleanly when more providers are added.
 */

'use strict';

const Joi = require('joi');

const PLATFORM = Joi.string().valid('facebook').required();

exports.initiate = {
    body: Joi.object({
        platform: PLATFORM.messages({
            'any.only': 'platform must be facebook',
            'any.required': 'platform is required',
        }),
    }),
};

// State token format is `{platform}:{shopId}:{userId}:{32-hex-nonce}` —
// ~115 chars for facebook. The previous length(64) cap was a leftover from a
// pre-Phase-5 nonce-only design and would 400 every real callback. Range guard
// preserved against junk values.
exports.callback = {
    body: Joi.object({
        code: Joi.string().trim().min(10).required().messages({
            'any.required': 'OAuth code is required',
        }),
        state: Joi.string().trim().min(40).max(128).required().messages({
            'string.min': 'Invalid state token',
            'string.max': 'Invalid state token',
            'any.required': 'State token is required',
        }),
    }),
};

exports.connectAsset = {
    body: Joi.object({
        // FB page id.
        assetId: Joi.string().trim().max(64).required().messages({
            'any.required': 'assetId is required',
        }),
        displayName: Joi.string().trim().max(255).required().messages({
            'any.required': 'displayName is required',
        }),
        // tempToken is the raw Meta long-lived user access token returned by
        // /oauth/callback (handleCallback assigns userToken → tempToken).
        // Meta user tokens are ~180-220 chars; the previous length(64) cap was
        // a leftover from a pre-Phase-5 hex-nonce design and would 400 every
        // real first connection. Range guard preserved against junk values.
        tempToken: Joi.string().trim().min(40).max(512).required().messages({
            'string.min': 'tempToken is too short',
            'string.max': 'tempToken is too long',
            'any.required': 'tempToken is required',
        }),
        platform: PLATFORM.messages({
            'any.only': 'platform must be facebook',
            'any.required': 'platform is required',
        }),
    }),
};

exports.channelIdParam = {
    params: Joi.object({
        channelId: Joi.string().uuid().required().messages({
            'string.uuid': 'channelId must be a valid UUID',
            'any.required': 'channelId is required',
        }),
    }),
};

// Phase 4: cosmetic purpose label (e.g. "Sales", "Live selling"). Empty string
// clears the label; null also clears it. Max 64 chars matches DB column.
exports.updatePurposeLabel = {
    params: Joi.object({
        channelId: Joi.string().uuid().required().messages({
            'string.uuid': 'channelId must be a valid UUID',
            'any.required': 'channelId is required',
        }),
    }),
    body: Joi.object({
        purposeLabel: Joi.string().trim().allow('', null).max(64).messages({
            'string.max': 'purposeLabel must be at most 64 characters',
        }),
    }),
};
