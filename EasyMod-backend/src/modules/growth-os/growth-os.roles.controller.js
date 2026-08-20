'use strict';

const roleService = require('./growth-os.roles.service');

exports.grantRole = async (req, res, next) => {
  try {
    const data = await roleService.grantRole({
      actorUserId: req.user.userId,
      targetUserId: req.body?.userId,
      role: req.body?.role,
      reason: req.body?.reason,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.revokeRole = async (req, res, next) => {
  try {
    const data = await roleService.revokeRole({
      actorUserId: req.user.userId,
      targetUserId: req.params.userId,
      reason: req.body?.reason,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
