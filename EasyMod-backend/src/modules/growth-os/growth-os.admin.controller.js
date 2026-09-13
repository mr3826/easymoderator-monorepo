'use strict';

// Admin Control Plane HTTP contracts. Route middleware has already enforced
// growth_os.admin.* (SUPER_ADMIN) or growth_os.merchants.read_insight
// (both roles, different response shape).

const merchants = require('./growth-os.merchants.service');

function base(req) {
  return {
    actorUserId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  };
}

const isSuper = (req) => req.growthOs?.role === 'SUPER_ADMIN';

async function listMerchants(req, res, next) {
  try {
    if (isSuper(req)) {
      const data = await merchants.listMerchantsAsAdmin({
        search: req.query.search || '',
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      return res.json({ success: true, data });
    }
    const data = await merchants.listMerchantsAsInsight({
      search: req.query.search || '',
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function merchantDetail(req, res, next) {
  try {
    if (isSuper(req)) {
      return res.json({ success: true, data: await merchants.getMerchant360(req.params.shopId) });
    }
    return res.json({ success: true, data: await merchants.getMerchantInsight(req.params.shopId) });
  } catch (error) {
    return next(error);
  }
}

async function setMerchantStatus(req, res, next) {
  try {
    const data = await merchants.setMerchantStatus({
      ...base(req),
      shopId: req.params.shopId,
      active: req.body.active,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function grantMerchantCredits(req, res, next) {
  try {
    const data = await merchants.grantMerchantCredits({
      ...base(req),
      shopId: req.params.shopId,
      amount: req.body.amount,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function requestChannelReconnect(req, res, next) {
  try {
    const data = await merchants.requestChannelReconnect({
      ...base(req),
      shopId: req.params.shopId,
      channelId: req.params.channelId,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function emergencyDisableMerchantAi(req, res, next) {
  try {
    const data = await merchants.emergencyDisableMerchantAi({
      ...base(req),
      shopId: req.params.shopId,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function operations(req, res, next) {
  try {
    res.json({ success: true, data: await merchants.getOperations({ windowDays: req.query.window }) });
  } catch (error) {
    next(error);
  }
}

async function auditLogs(req, res, next) {
  try {
    const data = await merchants.listPrivilegedAuditLogs({
      search: req.query.search || '',
      resourceType: req.query.resourceType || '',
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listMerchants,
  merchantDetail,
  setMerchantStatus,
  grantMerchantCredits,
  requestChannelReconnect,
  emergencyDisableMerchantAi,
  operations,
  auditLogs,
};
