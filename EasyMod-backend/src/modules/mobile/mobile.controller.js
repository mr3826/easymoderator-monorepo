'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { sendSuccess } = require('../../utils/AppError');
const attentionService = require('./attention.service');
const todayService = require('./today.service');

/** GET /api/mobile/attention — ADR M-008, MOBILE_PRODUCT_SPEC.md §2.1. */
const getAttention = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const result = await attentionService.getAttentionList(shopId);
    sendSuccess(res, result);
});

/** GET /api/mobile/today — ADR M-008, decision D4. */
const getToday = asyncHandler(async (req, res) => {
    const shopId = req.shop.id;
    const result = await todayService.getToday(shopId, req.shop.timezone);
    sendSuccess(res, result);
});

module.exports = { getAttention, getToday };
