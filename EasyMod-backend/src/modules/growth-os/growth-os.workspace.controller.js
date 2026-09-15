'use strict';

// Controllers for the Growth Workspace surfaces (home, analytics, search,
// follow-ups, notes). Authorization is enforced by route middleware; these
// handlers only adapt HTTP contracts to services.

const workspace = require('./growth-os.workspace.service');
const work = require('./growth-os.work.service');

function actor(req) {
  return {
    access: req.growthOs,
    userId: req.user.userId,
    isSuperAdmin: req.growthOs?.rawRole === 'SUPER_ADMIN',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  };
}

async function home(req, res, next) {
  try {
    const { access, userId, isSuperAdmin } = actor(req);
    res.json({ success: true, data: await workspace.getHome({ access, userId, isSuperAdmin }) });
  } catch (error) {
    next(error);
  }
}

async function analytics(req, res, next) {
  try {
    const { access, userId } = actor(req);
    res.json({
      success: true,
      data: await workspace.getGrowthAnalytics({ access, userId, windowDays: req.query.window }),
    });
  } catch (error) {
    next(error);
  }
}

async function search(req, res, next) {
  try {
    const { access, userId, isSuperAdmin } = actor(req);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: await workspace.globalSearch({ access, userId, query: req.body.q, isSuperAdmin }),
    });
  } catch (error) {
    next(error);
  }
}

async function createFollowup(req, res, next) {
  try {
    const { access, userId, ipAddress, userAgent } = actor(req);
    const data = await work.createFollowup({
      actorUserId: userId,
      access,
      prospectId: req.body.prospectId,
      ownerUserId: req.body.ownerUserId,
      dueAt: req.body.dueAt,
      action: req.body.action,
      note: req.body.note,
      ipAddress,
      userAgent,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function listFollowups(req, res, next) {
  try {
    const { access, userId } = actor(req);
    const data = await work.listFollowups({
      access,
      actorUserId: userId,
      prospectId: req.query.prospectId || null,
      state: req.query.state || 'open',
      owner: req.query.owner || null,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function updateFollowup(req, res, next) {
  try {
    const { access, userId, isSuperAdmin, ipAddress, userAgent } = actor(req);
    const data = await work.updateFollowup({
      actorUserId: userId,
      access,
      actorIsSuperAdmin: isSuperAdmin,
      followupId: req.params.id,
      ownerUserId: req.body.ownerUserId,
      dueAt: req.body.dueAt,
      action: req.body.action,
      note: req.body.note,
      ipAddress,
      userAgent,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function transitionFollowup(req, res, next) {
  try {
    const { access, userId, isSuperAdmin, ipAddress, userAgent } = actor(req);
    const data = await work.transitionFollowup({
      actorUserId: userId,
      access,
      actorIsSuperAdmin: isSuperAdmin,
      followupId: req.params.id,
      toStatus: req.body.status,
      ipAddress,
      userAgent,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function createNote(req, res, next) {
  try {
    const { access, userId, isSuperAdmin, ipAddress, userAgent } = actor(req);
    const data = await work.createNote({
      actorUserId: userId,
      access,
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      body: req.body.body,
      actorIsSuperAdmin: isSuperAdmin,
      ipAddress,
      userAgent,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function listNotes(req, res, next) {
  try {
    const { access, userId, isSuperAdmin } = actor(req);
    const data = await work.listNotes({
      access,
      actorUserId: userId,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
      actorIsSuperAdmin: isSuperAdmin,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function deleteNote(req, res, next) {
  try {
    const { access, userId, isSuperAdmin, ipAddress, userAgent } = actor(req);
    const data = await work.deleteNote({
      actorUserId: userId,
      access,
      noteId: req.params.id,
      actorIsSuperAdmin: isSuperAdmin,
      ipAddress,
      userAgent,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  home,
  analytics,
  search,
  createFollowup,
  listFollowups,
  updateFollowup,
  transitionFollowup,
  createNote,
  listNotes,
  deleteNote,
};
