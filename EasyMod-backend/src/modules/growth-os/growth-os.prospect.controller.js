'use strict';

const { AppError, sanitizeErrorMessage } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const service = require('./growth-os.prospect.service');

const logger = createLogger('GrowthOsProspectController');

function audit(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || null,
    metadata: { endpoint: req.originalUrl },
  };
}

function context(req) {
  return {
    userId: req.user.userId,
    access: req.growthOs,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function handleError(error, req, res, next) {
  if (error?.code === 'GROWTH_OS_PROSPECT_DUPLICATE') {
    return next(error);
  }
  if (error instanceof AppError) return next(error);
  logger.error('Growth OS prospect controller failed', {
    method: req.method,
    path: req.path,
    error: {
      name: error?.name || 'Error',
      message: sanitizeErrorMessage(error?.message || String(error)),
      ...(error?.code ? { code: error.code } : {}),
    },
  });
  return next(new AppError(
    'Growth OS prospect service is temporarily unavailable.',
    503,
    'GROWTH_OS_PROSPECT_UNAVAILABLE',
  ));
}

exports.listProspects = async (req, res, next) => {
  try {
    const data = await service.list({ ...context(req), filters: req.query });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.checkDuplicates = async (req, res, next) => {
  try {
    const data = await service.checkDuplicates({ ...context(req), data: req.query });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.createProspect = async (req, res, next) => {
  try {
    const result = await service.create({
      ...context(req),
      data: req.body,
      audit: audit(req),
    });
    res.status(201).json({ success: true, data: result.data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.getProspect = async (req, res, next) => {
  try {
    const data = await service.get({
      ...context(req),
      prospectId: req.params.id,
      timelinePage: req.query.timelinePage,
      timelinePageSize: req.query.timelinePageSize,
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.updateProspect = async (req, res, next) => {
  try {
    const data = await service.update({
      ...context(req),
      prospectId: req.params.id,
      data: req.body,
      audit: audit(req),
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.assignProspect = async (req, res, next) => {
  try {
    const ownerUserId = hasOwn(req.body, 'ownerUserId') ? req.body.ownerUserId : req.body.owner_user_id;
    const data = await service.assign({
      ...context(req),
      prospectId: req.params.id,
      ownerUserId,
      reason: req.body.reason,
      audit: audit(req),
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.transitionProspect = async (req, res, next) => {
  try {
    const data = await service.transition({
      ...context(req),
      prospectId: req.params.id,
      status: req.body.status,
      reason: req.body.reason,
      audit: audit(req),
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.linkProspect = async (req, res, next) => {
  try {
    const shopId = hasOwn(req.body, 'shopId') ? req.body.shopId : req.body.shop_id;
    const linkedUserId = hasOwn(req.body, 'userId') ? req.body.userId : req.body.user_id;
    const data = await service.link({
      ...context(req),
      prospectId: req.params.id,
      shopId,
      linkedUserId,
      reason: req.body.reason,
      audit: audit(req),
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.linkageSuggestions = async (req, res, next) => {
  try {
    const data = await service.linkageSuggestions({ ...context(req), prospectId: req.params.id });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};

exports.mergeProspect = async (req, res, next) => {
  try {
    const targetProspectId = hasOwn(req.body, 'targetProspectId')
      ? req.body.targetProspectId
      : req.body.target_prospect_id;
    const data = await service.merge({
      ...context(req),
      prospectId: req.params.id,
      targetProspectId,
      reason: req.body.reason,
      audit: audit(req),
    });
    res.json({ success: true, data });
  } catch (error) {
    handleError(error, req, res, next);
  }
};
