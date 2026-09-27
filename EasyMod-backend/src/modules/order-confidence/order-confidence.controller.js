'use strict';

const orderConfidenceService = require('./order-confidence.service');

// Tenant from the verified JWT; role from the active UserShop membership
// (verifyShopAccess). Neither is ever read from the request body.
const shopIdOf = (req) => req.user.shopId;

/**
 * 409s from a resolution carry the current decision (error.details.decision)
 * so the UI can refresh to what it would now be approving.
 */
const sendConflictOrNext = (error, res, next) => {
    if (error?.status === 409 && error?.details?.decision) {
        return res.status(409).json({
            success: false,
            error: { code: error.code, message: error.message, details: { decision: error.details.decision } },
        });
    }
    return next(error);
};

const getDecision = async (req, res, next) => {
    try {
        const data = await orderConfidenceService.getDecision(shopIdOf(req), req.params.orderId);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const verify = async (req, res, next) => {
    try {
        const data = await orderConfidenceService.verify(shopIdOf(req), req.params.orderId, {
            userId: req.user.userId,
            role: req.userRole,
            decisionVersion: req.body.decision_version,
            method: req.body.method,
            note: req.body.note || null,
        });
        res.json({ success: true, data });
    } catch (error) {
        sendConflictOrNext(error, res, next);
    }
};

const approve = async (req, res, next) => {
    try {
        const data = await orderConfidenceService.approve(shopIdOf(req), req.params.orderId, {
            userId: req.user.userId,
            role: req.userRole,
            decisionVersion: req.body.decision_version,
            note: req.body.note,
        });
        res.json({ success: true, data });
    } catch (error) {
        sendConflictOrNext(error, res, next);
    }
};

const summary = async (req, res, next) => {
    try {
        const data = await orderConfidenceService.summary(shopIdOf(req), req.query);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

module.exports = { getDecision, verify, approve, summary };
