'use strict';

const { AppError } = require('../../utils/AppError');
const service = require('./growth-os.prospect.service');

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
    const payload = error instanceof AppError
      ? error.toJSON(req.requestId || req.headers['x-request-id'] || 'unknown')
      : {
        success: false,
         code: 'GROWTH_OS_PROSPECT_DUPLICATE',
        message: 'A prospect with the same normalized identity already exists.',
      };
    payload.conflictingProspectId = error.conflictingProspectId || error.details?.conflictingProspectId;
    return res.status(409).json(payload);
  }
  if (error instanceof AppError) return next(error);
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
    const data = await service.get({ ...context(req), prospectId: req.params.id });
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
