'use strict';

// Smallest practical follow-up system + internal notes (§24, §34).
// Follow-ups are planned operator actions on prospects; the prospect ledger
// stays the source of truth — this table only references it.

const { Op } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const repository = require('./growth-os.prospect.repository');
const { resolveProspectScope } = require('./growth-os.prospect.scope');
const { NOTE_TARGET_TYPES } = require('./growth-os-note.entity');
const { redactSecretiveValues } = require('./growth-os.audit-sanitizer');
const { getBusinessDayBounds } = require('./growth-os.time');

const FOLLOWUP_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);
const MAX_PAGE_SIZE = 100;

function invalidInput(message, code = 'GROWTH_OS_WORK_INVALID_INPUT') {
  throw new AppError(message, 400, code);
}

async function writeWorkAudit({ actorUserId, action, resourceType, resourceId, shopId = null, oldValues, newValues, metadata = {}, ipAddress, userAgent }, transaction) {
  try {
    const { AuditLog } = require('../entities');
    await AuditLog.create({
      user_id: actorUserId,
      shop_id: shopId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_values: redactSecretiveValues(oldValues || null),
      new_values: redactSecretiveValues(newValues || null),
      metadata: redactSecretiveValues({ source: 'growth_os_work', ...metadata }),
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    }, { transaction });
  } catch (_error) {
    throw new AppError(
      'Growth OS audit service is temporarily unavailable.',
      503,
      'GROWTH_OS_AUDIT_UNAVAILABLE',
    );
  }
}

function getSequelize() {
  return require('../../utils/database/database-setup').sequelize;
}

function getModels() {
  const { GrowthOsFollowup, GrowthOsNote, GrowthOsProspectEvent } = require('../entities');
  return { GrowthOsFollowup, GrowthOsNote, GrowthOsProspectEvent };
}

function forbidden(message = 'Forbidden.') {
  throw new AppError(message, 403, 'GROWTH_OS_FORBIDDEN');
}

function assertFollowupAccess({ access, actorUserId, actorIsSuperAdmin = false }) {
  // Follow-up mutations must never fall back to an unscoped service call. The
  // route middleware supplies this context, but direct callers are denied too.
  if (!access || !actorUserId) {
    forbidden('Forbidden: Growth OS access required.');
  }
  const scope = resolveProspectScope(access, actorUserId);
  if (scope.kind === 'none') {
    forbidden('Forbidden: follow-up access required.');
  }
  return {
    scope,
    canManageAny: actorIsSuperAdmin === true || scope.kind === 'all',
  };
}

async function assertActiveGrowthOwner(ownerUserId, transaction) {
  const growthRole = await repository.findActiveGrowthRoleForUser(ownerUserId, {
    transaction,
    lock: true,
  });
  if (!growthRole) {
    throw new AppError(
      'Owner user must have an active Growth OS role.',
      400,
      'GROWTH_OS_PROSPECT_INVALID_OWNER',
    );
  }
}

function assertCanManageFollowup({ row, actorUserId, canManageAny }) {
  if (!canManageAny && row.owner_user_id !== actorUserId && row.created_by !== actorUserId) {
    forbidden('Forbidden: follow-up ownership is required.');
  }
}

function assertFollowupOwnerPermission({ ownerUserId, currentOwnerUserId, actorUserId, canManageAny }) {
  if (!canManageAny && ownerUserId !== actorUserId && ownerUserId !== currentOwnerUserId) {
    forbidden('Forbidden: scoped users may only assign follow-ups to themselves or retain the current owner.');
  }
}

function toApiFollowup(row) {
  const now = Date.now();
  return {
    id: row.id,
    prospectId: row.prospect_id,
    prospectName: row.prospect?.business_name || null,
    ownerUserId: row.owner_user_id || null,
    createdByUserId: row.created_by || null,
    dueAt: row.due_at,
    action: row.action,
    note: row.note || null,
    status: row.status,
    completedAt: row.completed_at || null,
    overdue: row.status === 'open' && new Date(row.due_at).getTime() < now,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertAccessibleProspect(prospectId, access, userId, { transaction, lock = false } = {}) {
  const scope = resolveProspectScope(access, userId);
  const options = {
    scope,
    transaction,
    include: false,
  };
  if (lock) options.lock = true;
  const prospect = await repository.findProspectById(prospectId, options);
  if (!prospect) {
    throw new AppError('Prospect was not found within your scope.', 404, 'GROWTH_OS_PROSPECT_NOT_FOUND');
  }
  if (prospect.status === 'merged') {
    throw new AppError('Merged prospects cannot carry new work items.', 409, 'GROWTH_OS_WORK_ON_MERGED_PROSPECT');
  }
  return prospect;
}

async function createFollowup({
  actorUserId, access, prospectId, ownerUserId, dueAt, action, note,
  ipAddress, userAgent,
}) {
  if (!action || typeof action !== 'string' || action.trim().length === 0 || action.length > 200) {
    invalidInput('action is required and must be 1..200 characters.');
  }
  if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) {
    invalidInput('dueAt must be a valid date/time.');
  }
  if (note && String(note).length > 2000) invalidInput('note must be 2000 characters or fewer.');
  const { canManageAny } = assertFollowupAccess({
    access,
    actorUserId,
    actorIsSuperAdmin: access?.role === 'SUPER_ADMIN',
  });
  const resolvedOwner = ownerUserId === undefined ? actorUserId : ownerUserId;
  if (!resolvedOwner) invalidInput('ownerUserId must identify an active Growth OS user.');
  const db = getSequelize();
  return db.transaction(async (transaction) => {
    await assertAccessibleProspect(prospectId, access, actorUserId, { transaction, lock: true });
    await assertActiveGrowthOwner(resolvedOwner, transaction);
    assertFollowupOwnerPermission({
      ownerUserId: resolvedOwner,
      currentOwnerUserId: null,
      actorUserId,
      canManageAny,
    });
    const { GrowthOsFollowup } = getModels();
    const row = await GrowthOsFollowup.create({
      prospect_id: prospectId,
      owner_user_id: resolvedOwner,
      created_by: actorUserId,
      due_at: new Date(dueAt),
      action: action.trim(),
      note: note ? String(note) : null,
      status: 'open',
    }, { transaction });
    await writeWorkAudit({
      actorUserId,
      action: 'growth_os:followup_created',
      resourceType: 'growth_os_followup',
      resourceId: row.id,
       newValues: redactSecretiveValues({ prospect_id: prospectId, owner_user_id: resolvedOwner, due_at: row.due_at, action: row.action }),
      ipAddress,
      userAgent,
    }, transaction);
    const { GrowthOsProspectEvent } = getModels();
    await GrowthOsProspectEvent.create({
      prospect_id: prospectId,
      actor_user_id: actorUserId,
      event_type: 'followup_created',
      to_value: row.due_at.toISOString(),
      changed_fields: [],
       metadata: redactSecretiveValues({ followup_id: row.id, action: row.action, owner_user_id: resolvedOwner }),
    }, { transaction });
    return toApiFollowup(row);
  });
}

async function listFollowups({
  access, actorUserId, prospectId = null, state = 'open', owner = null, page = 1, pageSize = 50,
}) {
  if (!FOLLOWUP_STATUSES.includes(state) && state !== 'all' && state !== 'overdue' && state !== 'due_today') {
    invalidInput("state must be open|completed|cancelled|overdue|due_today|all.");
  }
  const resolvedPageSize = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), MAX_PAGE_SIZE);
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  assertFollowupAccess({
    access,
    actorUserId,
    actorIsSuperAdmin: access?.rawRole === 'SUPER_ADMIN',
  });
  const scope = resolveProspectScope(access, actorUserId);
  const where = {};
  if (prospectId) where.prospect_id = prospectId;
  if (owner === 'me' || owner === actorUserId) where.owner_user_id = actorUserId;
  if (state === 'overdue' || state === 'open' || state === 'due_today') {
    where.status = 'open';
    if (state === 'overdue') where.due_at = { [Op.lt]: new Date() };
    if (state === 'due_today') {
      const { start, end } = getBusinessDayBounds();
      where.due_at = { [Op.gte]: start, [Op.lt]: end };
    }
  } else if (state !== 'all') {
    where.status = state;
  }
  const { GrowthOsFollowup } = getModels();
  const include = [{
    model: repository.getModels().GrowthOsProspect,
    as: 'prospect',
    required: true,
    attributes: ['id', 'business_name'],
    ...(scope.kind === 'all' ? {} : { where: scope.where }),
  }];
  const { rows, count } = await GrowthOsFollowup.findAndCountAll({
    where,
    include,
    order: [['due_at', 'ASC'], ['created_at', 'ASC']],
    limit: resolvedPageSize,
    offset: (resolvedPage - 1) * resolvedPageSize,
    distinct: true,
    subQuery: false,
  });
  return {
    items: rows.map(toApiFollowup),
    total: count,
    page: resolvedPage,
    pageSize: resolvedPageSize,
  };
}

async function transitionFollowup({
  actorUserId, access, actorIsSuperAdmin = false, followupId, toStatus, ipAddress, userAgent,
}) {
  const { canManageAny } = assertFollowupAccess({ access, actorUserId, actorIsSuperAdmin });
  // Only terminal targets are valid here. The HTTP validator already restricts
  // this, but a direct service caller must not be able to reopen or no-op a
  // row either; the source check below keeps every non-open row terminal.
  if (toStatus !== 'completed' && toStatus !== 'cancelled') {
    invalidInput('target status must be completed or cancelled.');
  }
  const db = getSequelize();
  return db.transaction(async (transaction) => {
    const { GrowthOsFollowup, GrowthOsProspectEvent } = getModels();
    const row = await GrowthOsFollowup.findByPk(followupId, {
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!row) throw new AppError('Follow-up was not found.', 404, 'GROWTH_OS_FOLLOWUP_NOT_FOUND');
    // Lock the related prospect and authorize it in this transaction. This
    // keeps scoped ownership checks and the status write in one locked view.
    await assertAccessibleProspect(row.prospect_id, access, actorUserId, { transaction, lock: true });
    assertCanManageFollowup({
      row,
      actorUserId,
      canManageAny,
    });
    if (row.status !== 'open') {
      throw new AppError('Completed or cancelled follow-ups cannot be reopened. Create a new one.', 409, 'GROWTH_OS_FOLLOWUP_DONE');
    }
    const oldStatus = row.status;
    await row.update({
      status: toStatus,
      completed_at: toStatus === 'completed' ? new Date() : null,
      completed_by: toStatus === 'completed' ? actorUserId : null,
    }, { transaction });
    await writeWorkAudit({
      actorUserId,
      action: toStatus === 'completed' ? 'growth_os:followup_completed' : 'growth_os:followup_cancelled',
      resourceType: 'growth_os_followup',
      resourceId: row.id,
      oldValues: { status: oldStatus },
      newValues: { status: toStatus },
      ipAddress,
      userAgent,
    }, transaction);
    await GrowthOsProspectEvent.create({
      prospect_id: row.prospect_id,
      actor_user_id: actorUserId,
      event_type: toStatus === 'completed' ? 'followup_completed' : 'followup_cancelled',
      metadata: { followup_id: row.id },
    }, { transaction });
    return toApiFollowup(row);
  });
}

async function updateFollowup({
  actorUserId, access, actorIsSuperAdmin = false, followupId, ownerUserId, dueAt, action, note, ipAddress, userAgent,
}) {
  const { canManageAny } = assertFollowupAccess({ access, actorUserId, actorIsSuperAdmin });
  const db = getSequelize();
  return db.transaction(async (transaction) => {
    const { GrowthOsFollowup } = getModels();
    const row = await GrowthOsFollowup.findByPk(followupId, {
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!row) throw new AppError('Follow-up was not found.', 404, 'GROWTH_OS_FOLLOWUP_NOT_FOUND');
    // The prospect is re-checked and locked after the follow-up row so the
    // authorization decision cannot race a prospect reassignment.
    await assertAccessibleProspect(row.prospect_id, access, actorUserId, { transaction, lock: true });
    assertCanManageFollowup({
      row,
      actorUserId,
      canManageAny,
    });
    if (row.status !== 'open') {
      throw new AppError('Only open follow-ups can be edited.', 409, 'GROWTH_OS_FOLLOWUP_DONE');
    }
    const values = {};
    if (ownerUserId !== undefined) {
      const nextOwner = ownerUserId;
      if (!nextOwner) invalidInput('ownerUserId must identify an active Growth OS user.');
      await assertActiveGrowthOwner(nextOwner, transaction);
      assertFollowupOwnerPermission({
        ownerUserId: nextOwner,
        currentOwnerUserId: row.owner_user_id,
        actorUserId,
        canManageAny,
      });
      values.owner_user_id = nextOwner;
    }
    if (dueAt !== undefined) {
      if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) invalidInput('dueAt must be a valid date/time.');
      values.due_at = new Date(dueAt);
    }
    if (action !== undefined) {
      if (!action || String(action).trim().length === 0 || action.length > 200) {
        invalidInput('action must be 1..200 characters.');
      }
      values.action = String(action).trim();
    }
    if (note !== undefined) values.note = note === null ? null : String(note).slice(0, 2000);
    if (Object.keys(values).length === 0) invalidInput('At least one field is required.');
    const oldValues = { due_at: row.due_at, action: row.action, owner_user_id: row.owner_user_id };
    const auditValues = { ...values };
    delete auditValues.note;
    await row.update(values, { transaction });
    await writeWorkAudit({
      actorUserId,
      action: 'growth_os:followup_updated',
      resourceType: 'growth_os_followup',
      resourceId: row.id,
      oldValues,
      newValues: auditValues,
      ipAddress,
      userAgent,
    }, transaction);
    return toApiFollowup(row);
  });
}

// ── Notes ───────────────────────────────────────────────────────────────────

function toApiNote(row, { redactAuthor = false, viewerUserId = null } = {}) {
  // A redacted scope still sees its own authorship attributed to itself; only
  // other people's identities are hidden, keeping create and list responses
  // consistent for the acting operator.
  const redacted = redactAuthor === true && row.author_user_id !== viewerUserId;
  const author = redacted ? null : row.authorUser || null;
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    authorUserId: redacted ? null : (row.author_user_id || null),
    // Live-joined projection for operator-facing attribution. A null
    // authorUserId without authorRedacted means the author record no longer
    // exists (FK SET NULL); the UI renders that as a removed-operator
    // fallback rather than a name or a raw UUID.
    authorDisplayName: author ? (author.full_name || author.email || null) : null,
    authorRedacted: redacted,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertNoteTarget({ targetType, targetId, access, userId, actorIsSuperAdmin }) {
  if (!NOTE_TARGET_TYPES.includes(targetType)) invalidInput('targetType must be prospect|user|shop.');
  if (!targetId) invalidInput('targetId is required.');
  const { User, Shop, GrowthOsProspect } = require('../entities');
  if (targetType === 'prospect') {
    await assertAccessibleProspect(targetId, access, userId, {});
    return;
  }
  // user/shop notes carry operational (potentially sensitive) context and are
  // restricted to Super Admin; the growth insight notes stay on prospects.
  if (!actorIsSuperAdmin) {
    throw new AppError(
      'Forbidden: merchant-context notes require Super Admin access.',
      403,
      'GROWTH_OS_FORBIDDEN',
    );
  }
  const target = targetType === 'user'
    ? await User.findByPk(targetId, { attributes: ['id'] })
    : await Shop.findByPk(targetId, { attributes: ['id'] });
  if (!target) throw new AppError('Note target was not found.', 404, 'GROWTH_OS_NOTE_TARGET_NOT_FOUND');
}

async function createNote({
  actorUserId, access, targetType, targetId, body, actorIsSuperAdmin, ipAddress, userAgent,
}) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) invalidInput('body is required.');
  if (text.length > 4000) invalidInput('body must be 4000 characters or fewer.');
  const db = getSequelize();
  return db.transaction(async (transaction) => {
    await assertNoteTarget({ targetType, targetId, access, userId: actorUserId, actorIsSuperAdmin });
    const { GrowthOsNote, GrowthOsProspectEvent } = getModels();
    const row = await GrowthOsNote.create({
      target_type: targetType,
      target_id: targetId,
      author_user_id: actorUserId,
      body: text,
    }, { transaction });
    await writeWorkAudit({
      actorUserId,
      action: 'growth_os:note_created',
      resourceType: 'growth_os_note',
      resourceId: row.id,
      newValues: { target_type: targetType, target_id: targetId },
      ipAddress,
      userAgent,
    }, transaction);
    if (targetType === 'prospect') {
      await GrowthOsProspectEvent.create({
        prospect_id: targetId,
        actor_user_id: actorUserId,
        event_type: 'note_added',
        metadata: { note_id: row.id },
      }, { transaction });
    }
    const { User } = require('../entities');
    const created = await GrowthOsNote.findByPk(row.id, {
      transaction,
      include: [{ model: User, as: 'authorUser', attributes: ['id', 'full_name', 'email'], required: false }],
    });
    return toApiNote(created);
  });
}

async function listNotes({
  access, actorUserId, targetType, targetId, actorIsSuperAdmin, page = 1, pageSize = 50,
}) {
  const resolvedPageSize = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), MAX_PAGE_SIZE);
  const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
  if (targetType === 'prospect') {
    await assertAccessibleProspect(targetId, access, actorUserId, {});
  } else if (targetType === 'user' || targetType === 'shop') {
    if (!actorIsSuperAdmin) {
      throw new AppError('Forbidden.', 403, 'GROWTH_OS_FORBIDDEN');
    }
  } else {
    invalidInput('targetType must be prospect|user|shop.');
  }
  const { GrowthOsNote } = getModels();
  const { User } = require('../entities');
  const scope = resolveProspectScope(access, actorUserId);
  const redactAuthor = targetType === 'prospect' && scope.redacted === true;
  const { rows, count } = await GrowthOsNote.findAndCountAll({
    where: { target_type: targetType, target_id: targetId, is_deleted: false },
    include: [{
      model: User,
      as: 'authorUser',
      attributes: ['id', 'full_name', 'email'],
      required: false,
    }],
    order: [['created_at', 'DESC']],
    limit: resolvedPageSize,
    offset: (resolvedPage - 1) * resolvedPageSize,
  });
  return {
    items: rows.map((row) => toApiNote(row, { redactAuthor, viewerUserId: actorUserId })),
    total: count,
    page: resolvedPage,
    pageSize: resolvedPageSize,
  };
}

// Soft delete only. Notes stay queryable for audit; nothing is destroyed.
async function deleteNote({ actorUserId, access, noteId, actorIsSuperAdmin, ipAddress, userAgent }) {
  const db = getSequelize();
  return db.transaction(async (transaction) => {
    const { GrowthOsNote } = getModels();
    const row = await GrowthOsNote.findByPk(noteId, { transaction });
    if (!row || row.is_deleted) {
      throw new AppError('Note was not found.', 404, 'GROWTH_OS_NOTE_NOT_FOUND');
    }
    if (row.author_user_id !== actorUserId && !actorIsSuperAdmin) {
      throw new AppError('Forbidden: only the author or a Super Admin can delete a note.', 403, 'GROWTH_OS_FORBIDDEN');
    }
    if (row.target_type === 'prospect' && row.author_user_id === actorUserId && !actorIsSuperAdmin) {
      // author may still be scoped to a redacted prospect; re-check access
      await assertAccessibleProspect(row.target_id, access, actorUserId, { transaction });
    }
    await row.update({ is_deleted: true }, { transaction });
    await writeWorkAudit({
      actorUserId,
      action: 'growth_os:note_deleted',
      resourceType: 'growth_os_note',
      resourceId: row.id,
      oldValues: { is_deleted: false },
      newValues: { is_deleted: true },
      ipAddress,
      userAgent,
    }, transaction);
    return { deleted: true };
  });
}

module.exports = {
  FOLLOWUP_STATUSES,
  createFollowup,
  listFollowups,
  updateFollowup,
  transitionFollowup,
  createNote,
  listNotes,
  deleteNote,
  toApiFollowup,
  toApiNote,
};
