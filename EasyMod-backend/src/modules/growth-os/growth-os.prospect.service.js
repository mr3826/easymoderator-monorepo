'use strict';

const { AppError } = require('../../utils/AppError');
const repository = require('./growth-os.prospect.repository');
const {
  PROSPECT_EVENT_TYPES,
  PROSPECT_STATUSES,
  canTransition,
  isProspectStatus,
  isProspectSource,
} = require('./growth-os.prospect.lifecycle');
const {
  normalizeIdentity,
  hasChannel,
} = require('./growth-os.prospect.identity');
const {
  resolveProspectScope,
  canManageAll,
  canRead,
} = require('./growth-os.prospect.scope');

const FIELD_ALIASES = Object.freeze({
  business_name: ['businessName', 'business_name'],
  contact_name: ['contactName', 'contact_name'],
  contact_phone: ['contactPhone', 'contact_phone'],
  contact_email: ['contactEmail', 'contact_email'],
  page_url: ['pageUrl', 'page_url'],
  niche: ['niche'],
  notes: ['notes'],
  source: ['source'],
  source_detail: ['sourceDetail', 'source_detail'],
  source_reference: ['sourceReference', 'source_reference'],
  metadata: ['metadata'],
});

const UPDATE_FIELDS = Object.freeze([
  'business_name',
  'contact_name',
  'contact_phone',
  'contact_email',
  'page_url',
  'niche',
  'notes',
  'source',
  'source_detail',
  'source_reference',
  'metadata',
]);

const MERGE_FIELDS = Object.freeze([
  'contact_name',
  'contact_phone',
  'contact_email',
  'page_url',
  'niche',
  'notes',
  'source_detail',
  'disqualified_reason',
  'owner_user_id',
  'assigned_at',
  'assigned_by',
  'linked_shop_id',
  'linked_user_id',
  'linked_at',
  'created_by',
]);

function getSequelize() {
  return require('../../utils/database/database-setup').sequelize;
}

function getAuditLog() {
  return require('../audit/audit-log.entity');
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function hasField(data, field) {
  return (FIELD_ALIASES[field] || [field]).some((key) => hasOwn(data, key));
}

function readField(data, field) {
  const aliases = FIELD_ALIASES[field] || [field];
  for (const alias of aliases) {
    if (hasOwn(data, alias)) return data[alias];
  }
  return undefined;
}

function cleanValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed || null;
}

function invalidInput(message) {
  return new AppError(message, 400, 'GROWTH_OS_PROSPECT_INVALID_INPUT');
}

function notFound() {
  return new AppError('Prospect not found.', 404, 'GROWTH_OS_PROSPECT_NOT_FOUND');
}

function mergedError() {
  return new AppError('Merged prospects cannot be changed.', 409, 'GROWTH_OS_PROSPECT_MERGED');
}

function duplicateError(conflictingProspectId) {
  const error = new AppError(
    'A prospect with the same normalized identity already exists.',
    409,
    'GROWTH_OS_PROSPECT_DUPLICATE',
    { conflictingProspectId },
  );
  error.conflictingProspectId = conflictingProspectId;
  return error;
}

function internalError() {
  return new AppError(
    'Growth OS prospect service is temporarily unavailable.',
    503,
    'GROWTH_OS_PROSPECT_UNAVAILABLE',
  );
}

function assertStringLength(value, field, max) {
  if (value !== null && value !== undefined && typeof value === 'string' && value.length > max) {
    throw invalidInput(`${field} must be at most ${max} characters.`);
  }
}

function assertMetadata(metadata) {
  if (metadata === undefined) return {};
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw invalidInput('metadata must be an object.');
  }
  return metadata;
}

function assertIdentity(values) {
  const identity = normalizeIdentity({
    business_name: values.business_name,
    contact_phone: values.contact_phone,
    contact_email: values.contact_email,
    page_url: values.page_url,
  });
  if (!identity.normalized_business_name) {
    throw invalidInput('businessName is required.');
  }
  assertStringLength(identity.normalized_business_name, 'normalizedBusinessName', 255);
  assertStringLength(identity.normalized_phone, 'normalizedPhone', 15);
  assertStringLength(identity.normalized_email, 'normalizedEmail', 255);
  assertStringLength(identity.normalized_page, 'normalizedPage', 255);
  if (!hasChannel(identity)) {
    throw invalidInput('At least one of contactPhone, contactEmail, or pageUrl is required.');
  }
  return identity;
}

function assertLifecycleValues(values) {
  if (!isProspectSource(values.source)) throw invalidInput('source is invalid.');
  if (!isProspectStatus(values.status)) throw invalidInput('status is invalid.');
  if (values.status === 'merged') throw invalidInput('merged can only be set by the merge operation.');
  if (values.status === 'converted' && !values.linked_shop_id) {
    throw invalidInput('converted prospects require linkedShopId.');
  }
  if (values.status === 'disqualified' && !values.disqualified_reason) {
    throw invalidInput('A reason is required for disqualified prospects.');
  }
}

function dateValue(value, field) {
  if (value === undefined || value === null) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidInput(`${field} must be a valid date.`);
  return date;
}

function buildCreateValues(data = {}, { actorUserId = null, internal = false } = {}) {
  const values = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    const value = readField(data, field);
    if (value !== undefined) values[field] = field === 'metadata' ? value : cleanValue(value);
  }

  if (!values.business_name) throw invalidInput('businessName is required.');
  if (!values.source) throw invalidInput('source is required.');
  assertStringLength(values.business_name, 'businessName', 255);
  assertStringLength(values.contact_name, 'contactName', 255);
  assertStringLength(values.contact_phone, 'contactPhone', 32);
  assertStringLength(values.contact_email, 'contactEmail', 255);
  assertStringLength(values.page_url, 'pageUrl', 2048);
  assertStringLength(values.niche, 'niche', 120);
  assertStringLength(values.source_detail, 'sourceDetail', 160);
  assertStringLength(values.source_reference, 'sourceReference', 255);

  values.metadata = assertMetadata(values.metadata);
  values.source_reference = values.source_reference || null;
  values.source_detail = values.source_detail || null;
  values.status = internal && data.status ? data.status : 'new';
  if (internal && data.disqualified_reason !== undefined) {
    values.disqualified_reason = cleanValue(data.disqualified_reason);
  }
  if (internal && (data.linked_shop_id !== undefined || data.linkedShopId !== undefined)) {
    values.linked_shop_id = data.linked_shop_id ?? data.linkedShopId ?? null;
  }
  if (internal && (data.linked_user_id !== undefined || data.linkedUserId !== undefined)) {
    values.linked_user_id = data.linked_user_id ?? data.linkedUserId ?? null;
  }
  if (internal && (data.owner_user_id !== undefined || data.ownerUserId !== undefined)) {
    values.owner_user_id = data.owner_user_id ?? data.ownerUserId ?? null;
  }
  if (internal && data.source_recorded_at !== undefined && data.source_recorded_at !== null) {
    values.source_recorded_at = dateValue(data.source_recorded_at, 'sourceRecordedAt');
  }

  const identity = assertIdentity(values);
  assertLifecycleValues({ ...values, ...identity });
  Object.assign(values, identity);
  if (actorUserId) values.created_by = actorUserId;
  if (values.owner_user_id) {
    values.assigned_at = dateValue(data.assigned_at, 'assignedAt') || new Date();
    values.assigned_by = data.assigned_by || actorUserId || null;
  }
  if (values.linked_shop_id || values.linked_user_id) values.linked_at = new Date();
  return values;
}

function buildUpdateValues(current, data = {}) {
  const values = {};
  for (const field of UPDATE_FIELDS) {
    if (!hasField(data, field)) continue;
    const value = readField(data, field);
    values[field] = field === 'metadata' ? value : cleanValue(value);
  }

  if (hasField(data, 'business_name') && !values.business_name) {
    throw invalidInput('businessName cannot be empty.');
  }
  if (hasField(data, 'source') && !values.source) throw invalidInput('source cannot be empty.');
  if (values.source && !isProspectSource(values.source)) throw invalidInput('source is invalid.');
  assertStringLength(values.business_name, 'businessName', 255);
  assertStringLength(values.contact_name, 'contactName', 255);
  assertStringLength(values.contact_phone, 'contactPhone', 32);
  assertStringLength(values.contact_email, 'contactEmail', 255);
  assertStringLength(values.page_url, 'pageUrl', 2048);
  assertStringLength(values.niche, 'niche', 120);
  assertStringLength(values.source_detail, 'sourceDetail', 160);
  assertStringLength(values.source_reference, 'sourceReference', 255);
  if (hasField(data, 'metadata')) values.metadata = assertMetadata(values.metadata);

  const nextValues = {
    ...current,
    ...values,
    business_name: values.business_name !== undefined ? values.business_name : current.business_name,
    contact_phone: values.contact_phone !== undefined ? values.contact_phone : current.contact_phone,
    contact_email: values.contact_email !== undefined ? values.contact_email : current.contact_email,
    page_url: values.page_url !== undefined ? values.page_url : current.page_url,
  };
  const identity = assertIdentity(nextValues);
  Object.assign(values, identity);
  if (values.business_name !== undefined) values.normalized_business_name = identity.normalized_business_name;
  if (['contact_phone', 'contact_email', 'page_url'].some((field) => hasField(data, field))) {
    Object.assign(values, identity);
  }
  return values;
}

function plain(record) {
  return typeof record?.toJSON === 'function' ? record.toJSON() : { ...record };
}

function auditSnapshot(record) {
  if (!record) return null;
  const data = plain(record);
  delete data.normalized_business_name;
  delete data.normalized_phone;
  delete data.normalized_email;
  delete data.normalized_page;
  delete data.ownerUser;
  delete data.assignedBy;
  delete data.linkedUser;
  delete data.linkedShop;
  return data;
}

function toApiProspect(record, scope) {
  const data = plain(record);
  const redacted = scope?.redacted === true;
  const anyChannel = Boolean(data.normalized_phone || data.normalized_email || data.normalized_page);
  const response = {
    id: data.id,
    businessName: data.business_name,
    contactName: redacted ? null : data.contact_name,
    contactPhone: redacted ? null : data.contact_phone,
    contactEmail: redacted ? null : data.contact_email,
    pageUrl: redacted ? null : data.page_url,
    niche: data.niche,
    notes: data.notes,
    source: data.source,
    sourceDetail: data.source_detail,
    sourceReference: data.source_reference,
    sourceRecordedAt: data.source_recorded_at,
    status: data.status,
    statusChangedAt: data.status_changed_at,
    disqualifiedReason: data.disqualified_reason,
    ownerUserId: data.owner_user_id,
    assignedAt: data.assigned_at,
    assignedBy: data.assigned_by,
    linkedShopId: data.linked_shop_id,
    linkedUserId: data.linked_user_id,
    linkedAt: data.linked_at,
    mergedIntoId: data.merged_into_id,
    mergedAt: data.merged_at,
    createdBy: data.created_by,
    metadata: data.metadata || {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    eligibleForNextPhase: Boolean(
      data.status === 'qualified'
      && data.status !== 'merged'
      && data.owner_user_id
      && anyChannel,
    ),
  };
  if (redacted) response.redacted = true;
  return response;
}

function toApiEvent(record) {
  const data = plain(record);
  return {
    id: data.id,
    prospectId: data.prospect_id,
    eventType: data.event_type,
    actorUserId: data.actor_user_id,
    fromValue: data.from_value,
    toValue: data.to_value,
    reason: data.reason,
    changedFields: Array.isArray(data.changed_fields) ? data.changed_fields : [],
    metadata: data.metadata || {},
    createdAt: data.created_at,
  };
}

function assertReadScope(access, userId) {
  if (!canRead(access)) throw new AppError('Forbidden: prospect access required.', 403, 'FORBIDDEN');
  const scope = resolveProspectScope(access, userId);
  if (scope.kind === 'none') throw new AppError('Forbidden: prospect access required.', 403, 'FORBIDDEN');
  return scope;
}

function assertEditAccess(access) {
  if (!canManageAll(access) && !access?.permissions?.includes('growth_os.prospects.update_assigned')) {
    throw new AppError('Forbidden: prospect update access required.', 403, 'FORBIDDEN');
  }
}

function assertStatusAccess(access) {
  assertEditAccess(access);
}

function assertManageAll(access, message) {
  if (!canManageAll(access)) throw new AppError(message, 403, 'FORBIDDEN');
}

async function writeProspectEvent({
  prospectId,
  actorUserId,
  eventType,
  fromValue = null,
  toValue = null,
  reason = null,
  changedFields = [],
  metadata = {},
}, transaction) {
  if (!PROSPECT_EVENT_TYPES.includes(eventType)) throw invalidInput('eventType is invalid.');
  try {
    const { GrowthOsProspectEvent } = repository.getModels();
    return await GrowthOsProspectEvent.create({
      prospect_id: prospectId,
      actor_user_id: actorUserId || null,
      event_type: eventType,
      from_value: fromValue || null,
      to_value: toValue || null,
      reason: reason || null,
      changed_fields: changedFields,
      metadata,
    }, { transaction });
  } catch (_error) {
    throw internalError();
  }
}

async function writeAudit({
  actorUserId,
  prospectId,
  action,
  oldValues,
  newValues,
  metadata = {},
  ipAddress,
  userAgent,
}, transaction) {
  try {
    const AuditLog = getAuditLog();
    await AuditLog.create({
      user_id: actorUserId || null,
      shop_id: null,
      action,
      resource_type: 'growth_os_prospect',
      resource_id: prospectId,
      old_values: oldValues,
      new_values: newValues,
      metadata: { source: 'growth_os_prospect', ...metadata },
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    }, { transaction });
  } catch (_error) {
    throw internalError();
  }
}

async function recordMutation(context, transaction) {
  const event = await writeProspectEvent(context, transaction);
  await writeAudit({
    ...context,
    metadata: { ...(context.metadata || {}), event_id: event.id },
  }, transaction);
  return event;
}

function mutationAudit(audit = {}) {
  return {
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    metadata: audit.metadata || {},
  };
}

async function safeFindConflict(identity, values, { scope = null, excludeId = null } = {}) {
  try {
    return await repository.findConflict(identity, {
      scope,
      excludeId,
      source: values.source,
      sourceReference: values.sourceReference ?? values.source_reference,
    });
  } catch (_error) {
    return null;
  }
}

async function runWithDatabaseProtection(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw internalError();
  }
}

class GrowthOsProspectService {
  async list({ userId, access, filters = {} }) {
    const scope = assertReadScope(access, userId);
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const result = await runWithDatabaseProtection(() => repository.listProspects({
      scope,
      filters,
      page,
      pageSize,
    }));
    const total = Number(result.count || 0);
    return {
      items: result.rows.map((row) => toApiProspect(row, scope)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async checkDuplicates({ userId, access, data = {} }) {
    const scope = assertReadScope(access, userId);
    const identity = normalizeIdentity({
      contact_phone: readField(data, 'contact_phone'),
      contact_email: readField(data, 'contact_email'),
      page_url: readField(data, 'page_url'),
    });
    if (!hasChannel(identity)) return { matches: [] };
    const excludeId = readField(data, 'exclude_id') || data.excludeId || null;
    const conflicts = await runWithDatabaseProtection(() => repository.findDuplicateProspects(identity, {
      scope,
      excludeId,
    }));
    return {
      matches: conflicts.map((row) => {
        const record = plain(row);
        return {
          prospectId: record.id,
          businessName: record.business_name,
          status: record.status,
          matchedFields: [
            identity.normalized_phone && record.normalized_phone === identity.normalized_phone ? 'contactPhone' : null,
            identity.normalized_email && record.normalized_email === identity.normalized_email ? 'contactEmail' : null,
            identity.normalized_page && record.normalized_page === identity.normalized_page ? 'pageUrl' : null,
          ].filter(Boolean),
        };
      }),
    };
  }

  async _create({
    userId = null,
    access = null,
    data,
    audit = {},
    internal = false,
    importMode = false,
  }) {
    if (!internal && !canManageAll(access)) {
      throw new AppError('Forbidden: prospect creation access required.', 403, 'FORBIDDEN');
    }
    const values = buildCreateValues(data, { actorUserId: userId, internal });
    const identity = {
      normalized_phone: values.normalized_phone,
      normalized_email: values.normalized_email,
      normalized_page: values.normalized_page,
    };
    const db = getSequelize();
    const models = repository.getModels();
    try {
      return await db.transaction(async (transaction) => {
        const sourceMatch = await repository.findBySourceReference(
          values.source,
          values.source_reference,
          { transaction },
        );
        if (sourceMatch) {
          if (importMode) return { prospect: sourceMatch, created: false, skippedDuplicate: true };
          throw duplicateError(sourceMatch.id);
        }

        const conflict = await repository.findDuplicateProspects(identity, { transaction });
        if (conflict[0]) {
          if (importMode) return {
            prospect: conflict[0],
            created: false,
            skippedDuplicate: true,
            conflictingProspectId: conflict[0].id,
          };
          throw duplicateError(conflict[0].id);
        }

        const prospect = await models.GrowthOsProspect.create(values, { transaction });
        await recordMutation({
          prospectId: prospect.id,
          actorUserId: userId,
          eventType: internal ? 'imported' : 'created',
          changedFields: Object.keys(values).filter((field) => !field.startsWith('normalized_')),
          metadata: { source: prospect.source, source_reference: prospect.source_reference },
          action: internal ? 'growth_os:prospect_imported' : 'growth_os:prospect_created',
          oldValues: null,
          newValues: auditSnapshot(prospect),
          ...mutationAudit(audit),
        }, transaction);
        return { prospect, created: true, skippedDuplicate: false };
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        const conflict = await safeFindConflict(identity, values);
        if (conflict) {
          if (importMode) return {
            prospect: conflict,
            created: false,
            skippedDuplicate: true,
            conflictingProspectId: conflict.id,
          };
          throw duplicateError(conflict.id);
        }
        throw internalError();
      }
      throw error;
    }
  }

  async create(args) {
    const result = await this._create(args);
    const scope = resolveProspectScope(args.access, args.userId);
    return { data: toApiProspect(result.prospect, scope), created: result.created };
  }

  async createImported({ data, source, sourceReference, dryRun = true }) {
    const payload = {
      ...data,
      source,
      sourceReference,
      source_reference: sourceReference,
    };
    const values = buildCreateValues(payload, { internal: true });
    const identity = {
      normalized_phone: values.normalized_phone,
      normalized_email: values.normalized_email,
      normalized_page: values.normalized_page,
    };
    const existing = await runWithDatabaseProtection(() => repository.findBySourceReference(
      values.source,
      values.source_reference,
    ));
    if (existing) {
      return {
        created: false,
        skippedDuplicate: true,
        conflictingProspectId: existing.id,
        dryRun,
      };
    }
    const conflict = await runWithDatabaseProtection(() => repository.findDuplicateProspects(identity));
    if (conflict[0]) {
      return {
        created: false,
        skippedDuplicate: true,
        conflictingProspectId: conflict[0].id,
        dryRun,
      };
    }
    if (dryRun) return { created: false, wouldCreate: true, skippedDuplicate: false, dryRun: true };
    const result = await this._create({ data: payload, internal: true, importMode: true });
    return {
      created: result.created,
      skippedDuplicate: result.skippedDuplicate,
      conflictingProspectId: result.conflictingProspectId || null,
      dryRun: false,
      prospect: result.prospect,
    };
  }

  async get({ userId, access, prospectId }) {
    const scope = assertReadScope(access, userId);
    return runWithDatabaseProtection(async () => {
      const prospect = await repository.findProspectById(prospectId, { scope });
      if (!prospect) throw notFound();
      const events = await repository.listProspectEvents(prospectId, { scope });
      return {
        ...toApiProspect(prospect, scope),
        timeline: events.map(toApiEvent),
      };
    });
  }

  async update({ userId, access, prospectId, data, audit = {} }) {
    assertEditAccess(access);
    const scope = assertReadScope(access, userId);
    if (!UPDATE_FIELDS.some((field) => hasField(data, field))) throw invalidInput('At least one editable field is required.');
    const db = getSequelize();
    return runWithDatabaseProtection(async () => {
      try {
        const prospect = await db.transaction(async (transaction) => {
          const row = await repository.findProspectById(prospectId, {
            scope,
            transaction,
            lock: true,
            include: false,
          });
          if (!row) throw notFound();
          if (row.status === 'merged') throw mergedError();
          const oldValues = auditSnapshot(row);
          const values = buildUpdateValues(row, data);
          const identity = {
            normalized_phone: values.normalized_phone || row.normalized_phone,
            normalized_email: values.normalized_email || row.normalized_email,
            normalized_page: values.normalized_page || row.normalized_page,
          };
          if (['contact_phone', 'contact_email', 'page_url'].some((field) => hasField(data, field))) {
            Object.assign(identity, {
              normalized_phone: values.normalized_phone,
              normalized_email: values.normalized_email,
              normalized_page: values.normalized_page,
            });
          }
          const conflict = await repository.findDuplicateProspects(identity, {
            scope,
            excludeId: row.id,
            transaction,
          });
          if (conflict[0]) throw duplicateError(conflict[0].id);
          await row.update(values, { transaction });
          await recordMutation({
            prospectId: row.id,
            actorUserId: userId,
            eventType: 'updated',
            changedFields: Object.keys(values).filter((field) => !field.startsWith('normalized_')),
            metadata: {},
            action: 'growth_os:prospect_updated',
            oldValues,
            newValues: auditSnapshot(row),
            ...mutationAudit(audit),
          }, transaction);
          return row;
        });
        return toApiProspect(prospect, scope);
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          const current = await repository.findProspectById(prospectId, { scope });
          let values = current ? {
            source: current.source,
            source_reference: current.source_reference,
          } : {};
          let identity = {};
          if (current) {
            try {
              const attempted = buildUpdateValues(current, data);
              identity = {
                normalized_phone: attempted.normalized_phone,
                normalized_email: attempted.normalized_email,
                normalized_page: attempted.normalized_page,
              };
              values = {
                source: attempted.source || current.source,
                source_reference: attempted.source_reference !== undefined
                  ? attempted.source_reference
                  : current.source_reference,
              };
            } catch (_error) {
              // The original validation error is reported by the outer handler.
            }
          }
          const conflict = await safeFindConflict(identity, values, {
            scope,
            excludeId: prospectId,
          });
          throw duplicateError(conflict?.id);
        }
        throw error;
      }
    });
  }

  async assign({ userId, access, prospectId, ownerUserId, reason, audit = {} }) {
    assertManageAll(access, 'Forbidden: prospect assignment access required.');
    const scope = assertReadScope(access, userId);
    if (ownerUserId === undefined || !cleanValue(reason)) throw invalidInput('ownerUserId and reason are required.');
    if (ownerUserId) {
      const owner = await runWithDatabaseProtection(() => repository.findUserById(ownerUserId));
      if (!owner) throw new AppError('Owner user was not found.', 404, 'GROWTH_OS_PROSPECT_NOT_FOUND');
    }
    const db = getSequelize();
    return runWithDatabaseProtection(() => db.transaction(async (transaction) => {
      const prospect = await repository.findProspectById(prospectId, {
        scope,
        transaction,
        lock: true,
        include: false,
      });
      if (!prospect) throw notFound();
      if (prospect.status === 'merged') throw mergedError();
      const oldValues = auditSnapshot(prospect);
      const nextOwner = ownerUserId || null;
      await prospect.update({
        owner_user_id: nextOwner,
        assigned_at: nextOwner ? new Date() : null,
        assigned_by: nextOwner ? userId : null,
      }, { transaction });
      await recordMutation({
        prospectId: prospect.id,
        actorUserId: userId,
        eventType: nextOwner ? 'assigned' : 'unassigned',
        fromValue: oldValues.owner_user_id,
        toValue: nextOwner,
        reason,
        changedFields: ['owner_user_id', 'assigned_at', 'assigned_by'],
        metadata: {},
        action: nextOwner ? 'growth_os:prospect_assigned' : 'growth_os:prospect_unassigned',
        oldValues,
        newValues: auditSnapshot(prospect),
        ...mutationAudit(audit),
      }, transaction);
      return toApiProspect(prospect, scope);
    }));
  }

  async transition({ userId, access, prospectId, status, reason, audit = {} }) {
    assertStatusAccess(access);
    const scope = assertReadScope(access, userId);
    if (!isProspectStatus(status)) throw invalidInput('status is invalid.');
    const db = getSequelize();
    return runWithDatabaseProtection(() => db.transaction(async (transaction) => {
      const prospect = await repository.findProspectById(prospectId, {
        scope,
        transaction,
        lock: true,
        include: false,
      });
      if (!prospect) throw notFound();
      if (prospect.status === 'merged') throw mergedError();
      if (!canTransition(prospect.status, status)) {
        throw new AppError(
          `Invalid prospect lifecycle transition: ${prospect.status} -> ${status}`,
          409,
          'GROWTH_OS_PROSPECT_INVALID_TRANSITION',
        );
      }
      const normalizedReason = cleanValue(reason);
      if ((status === 'disqualified' || (prospect.status === 'disqualified' && status === 'qualifying'))
        && !normalizedReason) {
        throw invalidInput('A reason is required for disqualification and reopening.');
      }
      if (status === 'converted' && !prospect.linked_shop_id) {
        throw invalidInput('converted prospects require linkedShopId.');
      }
      const oldValues = auditSnapshot(prospect);
      await prospect.update({
        status,
        status_changed_at: new Date(),
        disqualified_reason: status === 'disqualified' ? normalizedReason : null,
      }, { transaction });
      await recordMutation({
        prospectId: prospect.id,
        actorUserId: userId,
        eventType: 'status_changed',
        fromValue: oldValues.status,
        toValue: status,
        reason: normalizedReason,
        changedFields: ['status', 'status_changed_at', 'disqualified_reason'],
        metadata: {},
        action: 'growth_os:prospect_status_changed',
        oldValues,
        newValues: auditSnapshot(prospect),
        ...mutationAudit(audit),
      }, transaction);
      return toApiProspect(prospect, scope);
    }));
  }

  async link({ userId, access, prospectId, shopId, linkedUserId, reason, audit = {} }) {
    assertManageAll(access, 'Forbidden: prospect linkage access required.');
    const scope = assertReadScope(access, userId);
    if (shopId === undefined && linkedUserId === undefined) throw invalidInput('shopId or userId is required.');
    if (!cleanValue(reason)) throw invalidInput('reason is required.');
    if (shopId) {
      const shop = await runWithDatabaseProtection(() => repository.findShopById(shopId));
      if (!shop) throw new AppError(
        'Link target shop was not found.',
        404,
        'GROWTH_OS_PROSPECT_LINK_TARGET_NOT_FOUND',
      );
    }
    if (linkedUserId) {
      const linkedUser = await runWithDatabaseProtection(() => repository.findUserById(linkedUserId));
      if (!linkedUser) throw new AppError(
        'Link target user was not found.',
        404,
        'GROWTH_OS_PROSPECT_LINK_TARGET_NOT_FOUND',
      );
    }
    const db = getSequelize();
    return runWithDatabaseProtection(() => db.transaction(async (transaction) => {
      const prospect = await repository.findProspectById(prospectId, {
        scope,
        transaction,
        lock: true,
        include: false,
      });
      if (!prospect) throw notFound();
      if (prospect.status === 'merged') throw mergedError();
      const oldValues = auditSnapshot(prospect);
      const updates = {};
      if (shopId !== undefined) updates.linked_shop_id = shopId || null;
      if (linkedUserId !== undefined) updates.linked_user_id = linkedUserId || null;
      const nextShop = updates.linked_shop_id !== undefined ? updates.linked_shop_id : prospect.linked_shop_id;
      const nextUser = updates.linked_user_id !== undefined ? updates.linked_user_id : prospect.linked_user_id;
      if (prospect.status === 'converted' && !nextShop) {
        throw invalidInput('converted prospects require linkedShopId.');
      }
      updates.linked_at = nextShop || nextUser ? new Date() : null;
      await prospect.update(updates, { transaction });
      const linked = Boolean(nextShop || nextUser);
      await recordMutation({
        prospectId: prospect.id,
        actorUserId: userId,
        eventType: linked ? 'linked' : 'unlinked',
        fromValue: oldValues.linked_shop_id || oldValues.linked_user_id,
        toValue: nextShop || nextUser,
        reason,
        changedFields: Object.keys(updates),
        metadata: {
          from_linked_shop_id: oldValues.linked_shop_id || null,
          to_linked_shop_id: nextShop || null,
          from_linked_user_id: oldValues.linked_user_id || null,
          to_linked_user_id: nextUser || null,
        },
        action: linked ? 'growth_os:prospect_linked' : 'growth_os:prospect_unlinked',
        oldValues,
        newValues: auditSnapshot(prospect),
        ...mutationAudit(audit),
      }, transaction);
      return toApiProspect(prospect, scope);
    }));
  }

  async linkageSuggestions({ userId, access, prospectId }) {
    const scope = assertReadScope(access, userId);
    return runWithDatabaseProtection(async () => {
      const prospect = await repository.findProspectById(prospectId, { scope });
      if (!prospect) throw notFound();
      const suggestions = await repository.findLinkageSuggestions(prospect);
      return suggestions.map((suggestion) => ({
        userId: suggestion.user_id,
        shopId: suggestion.shop_id,
        shopName: suggestion.shop_name,
        matchedFields: suggestion.matched_fields,
      }));
    });
  }

  async merge({ userId, access, prospectId, targetProspectId, reason, audit = {} }) {
    assertManageAll(access, 'Forbidden: prospect merge access required.');
    if (!targetProspectId || targetProspectId === prospectId) {
      throw invalidInput('A different targetProspectId is required.');
    }
    if (!cleanValue(reason)) throw invalidInput('reason is required.');
    const scope = assertReadScope(access, userId);
    const db = getSequelize();
    return runWithDatabaseProtection(async () => {
      try {
        return await db.transaction(async (transaction) => {
      const locked = await repository.lockProspectsByIds(
        [prospectId, targetProspectId],
        { scope, transaction },
      );
      const source = locked.find((row) => row.id === prospectId);
      const target = locked.find((row) => row.id === targetProspectId);
      if (!source || !target) throw notFound();
      if (source.status === 'merged' || target.status === 'merged') throw mergedError();

      const sourceOldValues = auditSnapshot(source);
      const targetOldValues = auditSnapshot(target);
      const targetUpdates = {};
      for (const field of MERGE_FIELDS) {
        if ((target[field] === null || target[field] === undefined || target[field] === '')
          && source[field] !== null && source[field] !== undefined && source[field] !== '') {
          targetUpdates[field] = source[field];
        }
      }

      const sourceMetadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
      const targetMetadata = target.metadata && typeof target.metadata === 'object' ? target.metadata : {};
      const mergedMetadata = { ...sourceMetadata, ...targetMetadata };
      if (Object.keys(mergedMetadata).length > 0) targetUpdates.metadata = mergedMetadata;

      const targetIdentity = normalizeIdentity({
        business_name: target.business_name,
        contact_phone: targetUpdates.contact_phone !== undefined ? targetUpdates.contact_phone : target.contact_phone,
        contact_email: targetUpdates.contact_email !== undefined ? targetUpdates.contact_email : target.contact_email,
        page_url: targetUpdates.page_url !== undefined ? targetUpdates.page_url : target.page_url,
      });
      Object.assign(targetUpdates, targetIdentity);
      if (!hasChannel(targetIdentity)) throw invalidInput('Merged target must retain at least one channel.');

       await source.update({
         status: 'merged',
        status_changed_at: new Date(),
        merged_into_id: target.id,
        merged_at: new Date(),
       }, { transaction });
       const conflict = await repository.findDuplicateProspects(targetIdentity, {
         excludeId: target.id,
         transaction,
       });
       if (conflict[0]) throw duplicateError(conflict[0].id);
       if (Object.keys(targetUpdates).length > 0) await target.update(targetUpdates, { transaction });

      await recordMutation({
        prospectId: source.id,
        actorUserId: userId,
        eventType: 'merged',
        fromValue: sourceOldValues.status,
        toValue: target.id,
        reason,
        changedFields: ['status', 'status_changed_at', 'merged_into_id', 'merged_at'],
        metadata: { target_prospect_id: target.id },
        action: 'growth_os:prospect_merged',
        oldValues: sourceOldValues,
        newValues: auditSnapshot(source),
        ...mutationAudit(audit),
      }, transaction);
      await recordMutation({
        prospectId: target.id,
        actorUserId: userId,
        eventType: 'merge_target',
        fromValue: null,
        toValue: source.id,
        reason,
        changedFields: Object.keys(targetUpdates).filter((field) => !field.startsWith('normalized_')),
        metadata: { merged_prospect_id: source.id },
        action: 'growth_os:prospect_merge_target',
        oldValues: targetOldValues,
        newValues: auditSnapshot(target),
        ...mutationAudit(audit),
      }, transaction);

      return {
        mergedProspect: toApiProspect(source, scope),
        targetProspect: toApiProspect(target, scope),
      };
        });
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          const [source, target] = await Promise.all([
            repository.findProspectById(prospectId, { scope }),
            repository.findProspectById(targetProspectId, { scope }),
          ]);
          if (source && target) {
            const targetIdentity = normalizeIdentity({
              business_name: target.business_name,
              contact_phone: target.contact_phone || source.contact_phone,
              contact_email: target.contact_email || source.contact_email,
              page_url: target.page_url || source.page_url,
            });
            const conflict = await safeFindConflict(targetIdentity, {
              source: target.source,
              source_reference: target.source_reference,
            });
            if (conflict && conflict.id !== target.id) throw duplicateError(conflict.id);
          }
          throw internalError();
        }
        throw error;
      }
    });
  }
}

module.exports = new GrowthOsProspectService();
module.exports.toApiProspect = toApiProspect;
module.exports.auditSnapshot = auditSnapshot;
