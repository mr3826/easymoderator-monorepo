'use strict';

// Growth OS user management (SUPER_ADMIN-only routes, wired in
// growth-os.routes.js with admin.users.* permissions).

const users = require('./growth-os.users.service');

function base(req) {
  return {
    actorUserId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  };
}

async function listGrowthUsers(req, res, next) {
  try {
    const data = await users.listGrowthUsers({ search: req.query.search || '' });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function createGrowthUser(req, res, next) {
  try {
    const data = await users.createGrowthUser({
      ...base(req),
      email: req.body.email,
      fullName: req.body.fullName,
      role: req.body.role,
      reason: req.body.reason,
    });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function setUserStatus(req, res, next) {
  try {
    const data = await users.setGrowthUserStatus({
      ...base(req),
      targetUserId: req.params.userId,
      active: req.body.active,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function changeUserRole(req, res, next) {
  try {
    const data = await users.changeGrowthUserRole({
      ...base(req),
      targetUserId: req.params.userId,
      role: req.body.role,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function revokeUserAccess(req, res, next) {
  try {
    const data = await users.revokeGrowthUserAccess({
      ...base(req),
      targetUserId: req.params.userId,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const data = await users.resetGrowthUserPassword({
      ...base(req),
      targetUserId: req.params.userId,
      reason: req.body.reason,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function revokeUserSessions(req, res, next) {
  try {
    const data = await users.revokeGrowthUserSessions({
      ...base(req),
      targetUserId: req.params.userId,
      reason: req.body.reason,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listGrowthUsers,
  createGrowthUser,
  setUserStatus,
  changeUserRole,
  revokeUserAccess,
  resetUserPassword,
  revokeUserSessions,
};
