'use strict';

const { Op } = require('sequelize');
const { sanitizeErrorMessage } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('GrowthOsProspectRepository');

function logRepositoryError(operation, error, context = {}) {
  logger.error(`Growth OS prospect repository ${operation} failed`, {
    ...context,
    error: {
      name: error?.name || 'Error',
      message: sanitizeErrorMessage(error?.message || String(error)),
      ...(error?.code ? { code: error.code } : {}),
    },
  });
  throw error;
}

const PROSPECT_ATTRIBUTES = [
  'id',
  'business_name',
  'contact_name',
  'contact_phone',
  'contact_email',
  'page_url',
  'niche',
  'notes',
  'normalized_business_name',
  'normalized_phone',
  'normalized_email',
  'normalized_page',
  'source',
  'source_detail',
  'source_reference',
  'source_recorded_at',
  'status',
  'status_changed_at',
  'disqualified_reason',
  'owner_user_id',
  'assigned_at',
  'assigned_by',
  'linked_shop_id',
  'linked_user_id',
  'linked_at',
  'merged_into_id',
  'merged_at',
  'created_by',
  'metadata',
  'created_at',
  'updated_at',
];

function getModels() {
  const {
    GrowthOsProspect,
    GrowthOsProspectEvent,
    GrowthOsUserRole,
    User,
    Shop,
  } = require('../entities');
  return { GrowthOsProspect, GrowthOsProspectEvent, GrowthOsUserRole, User, Shop };
}

function scopedWhere(scope, where = {}) {
  const scopeWhere = scope?.where || {};
  if (!where || Reflect.ownKeys(where).length === 0) return scopeWhere;
  if (!scopeWhere || Reflect.ownKeys(scopeWhere).length === 0) return where;
  return { [Op.and]: [scopeWhere, where] };
}

function relationshipIncludes() {
  const { User, Shop } = getModels();
  return [
    {
      model: User,
      as: 'ownerUser',
      attributes: ['id', 'full_name', 'email'],
      required: false,
    },
    {
      model: User,
      as: 'assignedBy',
      attributes: ['id', 'full_name', 'email'],
      required: false,
    },
    {
      model: User,
      as: 'linkedUser',
      attributes: ['id', 'full_name', 'email'],
      required: false,
    },
    {
      model: Shop,
      as: 'linkedShop',
      attributes: ['id', 'name', 'shop_name', 'is_active'],
      required: false,
    },
  ];
}

function searchWhere(value, GrowthOsProspect) {
  const search = String(value || '').trim();
  if (!search) return null;
  const operator = GrowthOsProspect.sequelize?.getDialect() === 'postgres' ? Op.iLike : Op.like;
  const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
  return {
    [Op.or]: [
      { normalized_business_name: { [operator]: pattern } },
      { contact_name: { [operator]: pattern } },
      { contact_phone: { [operator]: pattern } },
      { contact_email: { [operator]: pattern } },
      { page_url: { [operator]: pattern } },
    ],
  };
}

function prospectFilters(filters = {}, GrowthOsProspect) {
  const clauses = [];
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  const ownerUserId = filters.ownerUserId || filters.owner_user_id;
  if (ownerUserId) where.owner_user_id = ownerUserId;

  if (filters.linked !== undefined && filters.linked !== null) {
    const linked = filters.linked === true || filters.linked === 'true';
    where[Op.or] = linked
      ? [{ linked_shop_id: { [Op.ne]: null } }, { linked_user_id: { [Op.ne]: null } }]
      : [{ linked_shop_id: { [Op.is]: null } }, { linked_user_id: { [Op.is]: null } }];
    if (!linked) {
      delete where[Op.or];
      clauses.push({
        [Op.and]: [
          { linked_shop_id: { [Op.is]: null } },
          { linked_user_id: { [Op.is]: null } },
        ],
      });
    }
  }

  if (Reflect.ownKeys(where).length > 0) clauses.push(where);
  const search = searchWhere(filters.q, GrowthOsProspect);
  if (search) clauses.push(search);
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { [Op.and]: clauses };
}

async function listProspects({ scope, filters = {}, page = 1, pageSize = 20, transaction } = {}) {
  const { GrowthOsProspect } = getModels();
  const options = {
    where: scopedWhere(scope, prospectFilters(filters, GrowthOsProspect)),
    attributes: PROSPECT_ATTRIBUTES,
    include: relationshipIncludes(),
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  };
  if (transaction) options.transaction = transaction;
  return GrowthOsProspect.findAndCountAll(options).catch((error) => logRepositoryError(
    'list',
    error,
    { page, pageSize },
  ));
}

async function findProspectById(prospectId, { scope, transaction, lock = false, include = true } = {}) {
  const { GrowthOsProspect } = getModels();
  const options = {
    where: scopedWhere(scope, { id: prospectId }),
    attributes: PROSPECT_ATTRIBUTES,
  };
  if (include) options.include = relationshipIncludes();
  if (transaction) options.transaction = transaction;
  if (lock && transaction) options.lock = transaction.LOCK?.UPDATE;
  return GrowthOsProspect.findOne(options).catch((error) => logRepositoryError(
    'find by id',
    error,
    { prospectId },
  ));
}

function identityWhere(identity = {}) {
  return [
    identity.normalized_phone ? { normalized_phone: identity.normalized_phone } : null,
    identity.normalized_email ? { normalized_email: identity.normalized_email } : null,
    identity.normalized_page ? { normalized_page: identity.normalized_page } : null,
  ].filter(Boolean);
}

async function findDuplicateProspects(identity, {
  scope = null,
  excludeId = null,
  transaction,
} = {}) {
  const { GrowthOsProspect } = getModels();
  const matches = identityWhere(identity);
  if (matches.length === 0) return [];
  const where = {
    [Op.and]: [
      { [Op.or]: matches },
      { status: { [Op.ne]: 'merged' } },
    ],
  };
  if (excludeId) where[Op.and].push({ id: { [Op.ne]: excludeId } });
  const options = {
    where: scopedWhere(scope, where),
    order: [['created_at', 'ASC'], ['id', 'ASC']],
    limit: 10,
  };
  if (transaction) options.transaction = transaction;
  return GrowthOsProspect.findAll(options).catch((error) => logRepositoryError('find duplicates', error));
}

async function findBySourceReference(source, sourceReference, {
  scope,
  excludeId = null,
  transaction,
} = {}) {
  if (!source || !sourceReference) return null;
  const { GrowthOsProspect } = getModels();
  const where = {
    source,
    source_reference: sourceReference,
    status: { [Op.ne]: 'merged' },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const options = {
    where: scopedWhere(scope, where),
  };
  if (transaction) options.transaction = transaction;
  return GrowthOsProspect.findOne(options).catch((error) => logRepositoryError(
    'find source reference',
    error,
    { source, excludeId },
  ));
}

async function findConflict(identity, {
  scope = null,
  source,
  sourceReference,
  excludeId = null,
  transaction,
} = {}) {
  const byIdentity = await findDuplicateProspects(identity, { scope, excludeId, transaction });
  if (byIdentity[0]) return byIdentity[0];
  if (sourceReference) return findBySourceReference(source, sourceReference, {
    scope,
    excludeId,
    transaction,
  });
  return null;
}

async function listProspectEvents(prospectId, {
  scope,
  transaction,
  page = 1,
  pageSize = 20,
} = {}) {
  const { GrowthOsProspect, GrowthOsProspectEvent, User } = getModels();
  const boundedPage = Math.max(1, Number(page) || 1);
  const boundedPageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const options = {
    where: { prospect_id: prospectId },
    include: [
      {
        model: GrowthOsProspect,
        as: 'prospect',
        attributes: [],
        required: true,
        where: scope?.where || {},
      },
      {
        model: User,
        as: 'actor',
        attributes: scope?.redacted ? ['id'] : ['id', 'full_name', 'email'],
        required: false,
      },
    ],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
    limit: boundedPageSize,
    offset: (boundedPage - 1) * boundedPageSize,
    distinct: true,
  };
  if (transaction) options.transaction = transaction;
  return GrowthOsProspectEvent.findAndCountAll(options).catch((error) => logRepositoryError(
    'list events',
    error,
    { prospectId, page: boundedPage, pageSize: boundedPageSize },
  ));
}

async function findUserById(userId, { transaction, lock = false } = {}) {
  if (!userId) return null;
  const { User } = getModels();
  const options = { attributes: ['id', 'full_name', 'email', 'phone'] };
  if (transaction) options.transaction = transaction;
  if (lock && transaction) options.lock = transaction.LOCK?.UPDATE;
  return User.findByPk(userId, options).catch((error) => logRepositoryError(
    'find user',
    error,
    { userId },
  ));
}

async function findActiveGrowthRoleForUser(userId, { transaction, lock = false } = {}) {
  if (!userId) return null;
  const { GrowthOsUserRole } = getModels();
  const options = {
    where: {
      user_id: userId,
      is_active: true,
      revoked_at: { [Op.is]: null },
    },
    attributes: ['id', 'user_id', 'role'],
  };
  if (transaction) options.transaction = transaction;
  if (lock && transaction) options.lock = transaction.LOCK?.UPDATE;
  return GrowthOsUserRole.findOne(options).catch((error) => logRepositoryError(
    'find active Growth role',
    error,
    { userId },
  ));
}

async function findShopById(shopId, { transaction } = {}) {
  if (!shopId) return null;
  const { Shop } = getModels();
  const options = { attributes: ['id', 'name', 'shop_name', 'is_active'] };
  if (transaction) options.transaction = transaction;
  return Shop.findByPk(shopId, options).catch((error) => logRepositoryError(
    'find shop',
    error,
    { shopId },
  ));
}

async function lockProspectsByIds(ids, { scope, transaction } = {}) {
  const sortedIds = [...ids].sort();
  const rows = [];
  for (const id of sortedIds) {
    const row = await findProspectById(id, { scope, transaction, lock: true, include: false });
    if (row) rows.push(row);
  }
  return rows;
}

async function findLinkageSuggestions(prospect, { transaction } = {}) {
  const { User, Shop } = getModels();
  const identityWhere = [];
  const emailOperator = User.sequelize?.getDialect() === 'postgres' ? Op.iLike : Op.like;
  if (prospect.normalized_email) {
    identityWhere.push({ email: { [emailOperator]: prospect.normalized_email } });
  }
  if (prospect.normalized_phone) {
    const phoneDigits = String(prospect.normalized_phone).replace(/\D/g, '');
    identityWhere.push({ phone: { [Op.like]: `%${phoneDigits.slice(-10)}%` } });
  }
  if (identityWhere.length === 0) return [];

  const options = {
    where: { [Op.or]: identityWhere },
    attributes: ['id', 'email', 'phone', 'full_name'],
    include: [{
      model: Shop,
      as: 'shops',
      attributes: ['id', 'name', 'shop_name', 'is_active'],
      required: true,
      through: { attributes: [] },
    }],
    limit: 25,
  };
  if (transaction) options.transaction = transaction;
  const users = await User.findAll(options).catch((error) => logRepositoryError(
    'find linkage suggestions',
    error,
  ));
  const email = String(prospect.normalized_email || '').toLowerCase();
  const phone = String(prospect.normalized_phone || '').slice(-10);
  return users.flatMap((user) => (user.shops || []).map((shop) => {
    const userEmail = String(user.email || '').trim().toLowerCase();
    const userPhone = String(user.phone || '').replace(/\D/g, '').slice(-10);
    const matchedFields = [
      email && userEmail === email ? 'email' : null,
      phone && userPhone === phone ? 'phone' : null,
    ].filter(Boolean);
    return {
      user_id: user.id,
      shop_id: shop.id,
      shop_name: shop.name || shop.shop_name,
      matched_fields: matchedFields,
    };
  }));
}

module.exports = {
  getModels,
  scopedWhere,
  listProspects,
  findProspectById,
  findDuplicateProspects,
  findBySourceReference,
  findConflict,
  listProspectEvents,
  findUserById,
  findActiveGrowthRoleForUser,
  findShopById,
  lockProspectsByIds,
  findLinkageSuggestions,
  PROSPECT_ATTRIBUTES,
};
