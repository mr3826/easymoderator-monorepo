'use strict';

/**
 * Merchant-facing Knowledge Gap Suggestions API (Pilot+ P+05).
 * Flag-gated (knowledge_suggestions, default off), shop-scoped from the JWT
 * ONLY, deterministic suggestions only — publishing always flows through the
 * existing knowledge.service FAQ authority.
 */

const Joi = require('joi');
const gaps = require('./gap-suggestions.service');
const pilotFeatures = require('../pilot-features/pilot-features.service');

const shopOf = (req) => req.user?.shopId || null;
const userOf = (req) => req.user?.userId || req.user?.id || null;

const DISMISS_REASONS = ['NOT_USEFUL', 'ALREADY_ANSWERED', 'CONFIG_ONLY', 'OUTDATED', 'OTHER'];

const requireSuggestionsEnabled = async (req, res, next) => {
    try {
        const shopId = shopOf(req);
        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' } });
        }
        const enabled = await pilotFeatures.isKnowledgeSuggestionsEnabled(shopId);
        if (!enabled) {
            return res.status(409).json({
                success: false,
                error: { code: 'FEATURE_DISABLED', message: 'Knowledge suggestions are not enabled for this shop' },
            });
        }
        return next();
    } catch (error) {
        return next(error);
    }
};

const idSchema = Joi.object({ id: Joi.string().uuid().required() });

const list = async (req, res, next) => {
    try {
        const data = await gaps.listForShop(shopOf(req), { statuses: ['OPEN', 'IN_REVIEW'] });
        res.json({ success: true, data });
    } catch (error) { next(error); }
};

const review = async (req, res, next) => {
    try {
        const { error } = idSchema.validate(req.params);
        if (error) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
        }
        const moved = await gaps.startReview(shopOf(req), req.params.id);
        if (!moved) {
            return res.status(409).json({ success: false, error: { code: 'GAP_STATE_CONFLICT', message: 'Suggestion is not open for review' } });
        }
        res.json({ success: true, data: { status: 'IN_REVIEW' } });
    } catch (error) { next(error); }
};

const dismiss = async (req, res, next) => {
    try {
        const { error } = idSchema.validate(req.params);
        if (error) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
        }
        const body = Joi.attempt(req.body || {}, Joi.object({
            reason: Joi.string().valid(...DISMISS_REASONS).default('OTHER'),
        }));
        const done = await gaps.dismiss(shopOf(req), req.params.id, body.reason, userOf(req));
        if (!done) {
            return res.status(409).json({ success: false, error: { code: 'GAP_STATE_CONFLICT', message: 'Suggestion already resolved or dismissed' } });
        }
        res.json({ success: true, data: { status: 'DISMISSED' } });
    } catch (error) { next(error); }
};

const publish = async (req, res, next) => {
    try {
        const { error } = idSchema.validate(req.params);
        if (error) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
        }
        const { error: bodyError, value: body } = Joi.object({
            question: Joi.string().trim().min(3).max(300).required(),
            answer: Joi.string().trim().min(3).max(4000).required(),
            category: Joi.string().trim().max(80).allow(null, ''),
            priority: Joi.number().integer().min(0).max(100),
            is_active: Joi.boolean(),
        }).validate(req.body || {});
        if (bodyError) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: bodyError.message } });
        }
        const faq = await gaps.publishAnswer(shopOf(req), userOf(req), req.params.id, body);
        if (!faq) {
            return res.status(409).json({ success: false, error: { code: 'GAP_STATE_CONFLICT', message: 'Suggestion already resolved or dismissed' } });
        }
        res.status(201).json({ success: true, data: { faq_id: faq.id, status: 'PUBLISHED' } });
    } catch (error) {
        if (error?.isJoi) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
        }
        next(error);
    }
};

module.exports = { requireSuggestionsEnabled, list, review, dismiss, publish };
