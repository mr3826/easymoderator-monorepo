'use strict';

// Admin Control Plane merchant surface (SUPER_ADMIN) + Growth-internal
// masked merchant insight (GROWTH_USER). Reads compose canonical records;
// mutations delegate to the existing admin/domain services and never touch
// tables directly. The two view builders are separated on purpose: growth
// insight output must not absorb admin diagnostics.

const crypto = require('crypto');
const { Op, fn, col, literal } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const adminService = require('../admin/admin.service');
const { redactSecretiveValues } = require('./growth-os.audit-sanitizer');

const LIKE_WILDCARDS = /[\\%_]/g;

function escapeLike(value) {
  return String(value).replace(LIKE_WILDCARDS, (ch) => `\\${ch}`);
}

function likePattern(value) {
  return `%${escapeLike(String(value).trim().toLowerCase())}%`;
}

function clampPage(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function writeGrowthAudit({ actorUserId, shopId = null, action, resourceType, resourceId, oldValues, newValues, metadata = {}, ipAddress, userAgent }, transaction) {
  try {
    const { AuditLog } = require('../entities');
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
    await AuditLog.create({
      user_id: actorUserId,
      shop_id: shopId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_values: redactSecretiveValues(oldValues || null),
      new_values: redactSecretiveValues(newValues || null),
      metadata: redactSecretiveValues({ source: 'growth_os_admin_plane', ...safeMetadata }),
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

// ── Merchant list (SUPER_ADMIN full, GROWTH_USER masked insight) ────────────

async function listMerchantsAsAdmin({ search = '', page = 1, pageSize = 20 } = {}) {
  const result = await adminService.listShops({
    search: String(search || '').slice(0, 120),
    page: clampPage(page, 1),
    limit: Math.min(clampPage(pageSize, 20), 50),
  });
  return {
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.limit,
  };
}

async function listMerchantsAsInsight({ search = '', page = 1, pageSize = 20 } = {}) {
  const { Shop, Subscription, MetaChannel, GrowthOsProspect } = require('../entities');
  const safePage = clampPage(page, 1);
  const safeSize = Math.min(clampPage(pageSize, 20), 50);

  const where = {};
  const term = String(search || '').trim().slice(0, 120);
  if (term) {
    const pattern = likePattern(term);
    where[Op.or] = [
      { shop_name: { [Op.iLike]: pattern } },
      { name: { [Op.iLike]: pattern } },
    ];
  }

  const { rows, count } = await Shop.findAndCountAll({
    where,
      attributes: ['id', 'shop_name', 'name', 'created_at', 'settings'],
    include: [
      { model: Subscription, as: 'subscription', required: false, attributes: ['plan_name', 'status'] },
    ],
    order: [['created_at', 'DESC']],
    limit: safeSize,
    offset: (safePage - 1) * safeSize,
    distinct: true,
    subQuery: false,
  });

  const shopIds = rows.map((s) => s.id);
  const [connected, linked] = shopIds.length ? await Promise.all([
    MetaChannel.findAll({
      attributes: ['shop_id', literal('MAX("created_at") AS latest_at')],
      where: { shop_id: { [Op.in]: shopIds }, status: 'CONNECTED' },
      group: ['shop_id'],
    }),
    GrowthOsProspect.findAll({
       attributes: ['linked_shop_id', 'business_name', 'status', 'status_changed_at', 'merged_into_id'],
       where: { linked_shop_id: { [Op.in]: shopIds }, status: 'converted', merged_into_id: null },
    }),
  ]) : [[], []];
  const connectedSet = new Set(connected.map((c) => c.shop_id));
  const prospectsByShop = new Map();
  const activationByShop = new Map();
  for (const p of linked) {
    if (!prospectsByShop.has(p.linked_shop_id)) prospectsByShop.set(p.linked_shop_id, []);
    prospectsByShop.get(p.linked_shop_id).push(p.business_name);
    const current = activationByShop.get(p.linked_shop_id);
    if (!current || (p.status_changed_at && new Date(p.status_changed_at) < new Date(current))) {
      activationByShop.set(p.linked_shop_id, p.status_changed_at || null);
    }
  }

  return {
    items: rows.map((shop) => {
      return {
        shopId: shop.id,
        merchantName: shop.shop_name || shop.name,
        signupDate: shop.created_at,
        planName: shop.subscription?.plan_name || null,
        activatedAt: activationByShop.get(shop.id) || null,
        facebookConnected: connectedSet.has(shop.id),
        linkedProspects: prospectsByShop.get(shop.id) || [],
      };
    }),
    total: count,
    page: safePage,
    pageSize: safeSize,
  };
}

// ── Merchant 360 (SUPER_ADMIN) ───────────────────────────────────────────────

async function getMerchant360(shopId) {
  const {
    Shop, GrowthOsProspect, GrowthOsNote, Session,
  } = require('../entities');

  const [overview, channels, billing, prospects] = await Promise.all([
    adminService.getShopOverview(shopId),
    adminService.getShopChannels(shopId).catch(() => []),
    adminService.getShopBilling(shopId).catch(() => null),
     GrowthOsProspect.findAll({
      where: { linked_shop_id: shopId },
       attributes: ['id', 'business_name', 'status', 'source', 'owner_user_id', 'linked_at', 'status_changed_at'],
      limit: 10,
    }),
  ]);

  const shop = await Shop.findByPk(shopId, { attributes: ['settings'] });
   const settings = shop?.settings || {};
   const activatedProspect = prospects.find((prospect) => prospect.status === 'converted');

  return {
    overview: {
      ...overview,
      activation: {
         activatedAt: activatedProspect?.status_changed_at || null,
         firstConversationId: settings.first_ai_reply?.first_conversation_id || null,
      },
      ai: {
        configured: Boolean(settings.ai),
        automationMode: settings.ai?.automation_mode ?? null,
        draftModeEnabled: settings.ai?.automation_mode === 'DRAFT',
      },
      lastActivityAt: await Session.max('last_activity_at', { where: { shop_id: shopId } }),
    },
    growth: {
      linkedProspects: prospects.map((p) => ({
        prospectId: p.id,
        businessName: p.business_name,
        status: p.status,
        source: p.source,
        ownerUserId: p.owner_user_id,
        linkedAt: p.linked_at,
      })),
    },
    subscription: billing ? {
      plan: { code: billing.planCode, name: billing.planName, cycle: billing.billingCycle, model: billing.billingModel },
      status: billing.status,
      period: { start: billing.periodStart, end: billing.currentPeriodEnd, nextBillingDate: billing.nextBillingDate },
      usage: {
        conversationsUsed: billing.conversationsUsed,
        conversationsLimit: billing.conversationsLimit,
        effectiveLimit: billing.effectiveConversationLimit,
        topupBalance: billing.topupBalance,
      },
      invoices: billing.invoices,
      outstandingAmount: billing.outstandingAmount,
    } : null,
    facebook: { channels },
    notes: await listShopNotes(shopId),
  };
}

async function listShopNotes(shopId) {
  const { GrowthOsNote, User } = require('../entities');
  const rows = await GrowthOsNote.findAll({
    where: { target_type: 'shop', target_id: shopId, is_deleted: false },
    order: [['created_at', 'DESC']],
    limit: 50,
    include: [{ model: User, as: 'authorUser', attributes: ['id', 'full_name'], required: false }],
  });
  return rows.map((note) => ({
    id: note.id,
    targetType: note.target_type,
    targetId: note.target_id,
    author: note.authorUser
      ? { userId: note.authorUser.id, name: note.authorUser.full_name }
      : null,
    body: note.body,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  }));
}

// ── Merchant insight (GROWTH_USER — limited, masked, read-only) ─────────────

async function getMerchantInsight(shopId) {
  const { Shop, Subscription, MetaChannel, GrowthOsProspect, UserShop } = require('../entities');

  const shop = await Shop.findByPk(shopId, {
    attributes: ['id', 'shop_name', 'name', 'created_at', 'settings', 'is_active'],
  });
  if (!shop) {
    throw new AppError('Merchant was not found.', 404, 'GROWTH_OS_MERCHANT_NOT_FOUND');
  }
  const settings = shop.settings || {};

  const owners = await UserShop.findAll({
    attributes: ['user_id'],
    where: { shop_id: shopId, role: 'owner', is_active: true },
    raw: true,
  });
  const ownerIds = owners.map((row) => row.user_id);

  const [subscription, channelCount, linked] = await Promise.all([
    Subscription.findOne({ where: { shop_id: shopId }, attributes: ['plan_name', 'status'] }),
    MetaChannel.count({ where: { shop_id: shopId, status: 'CONNECTED' } }),
    GrowthOsProspect.findAll({
      where: {
        [Op.or]: [
          { linked_shop_id: shopId },
          ...(ownerIds.length ? [{ linked_user_id: { [Op.in]: ownerIds } }] : []),
        ],
      },
       attributes: ['id', 'business_name', 'status', 'source', 'created_at', 'status_changed_at', 'merged_into_id'],
      limit: 10,
    }),
  ]);

  return {
    shopId: shop.id,
    merchantName: shop.shop_name || shop.name,
    signupDate: shop.created_at,
    planName: subscription?.plan_name || null,
    subscriptionStatus: subscription?.status || null,
    activation: {
       activatedAt: shop.is_active && linked.some((prospect) => prospect.status === 'converted' && !prospect.merged_into_id)
         ? linked.find((prospect) => prospect.status === 'converted' && !prospect.merged_into_id)?.status_changed_at || null
         : null,
       state: shop.is_active && linked.some((prospect) => prospect.status === 'converted' && !prospect.merged_into_id)
         ? 'activated' : 'not_activated',
    },
    facebook: { connected: channelCount > 0 },
    linkedProspects: linked.map((p) => ({
      prospectId: p.id,
      businessName: p.business_name,
      status: p.status,
      source: p.source,
      createdAt: p.created_at,
    })),
    // Deliberately absent: owner PII, tokens, invoices, payments, internal
    // notes, infrastructure state — see Merchant 360 masking contract.
  };
}

// ── Administrative mutations (SUPER_ADMIN, reason-bearing, audited) ─────────

function assertReason(reason) {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  if (!normalized || normalized.length > 300) {
    throw new AppError(
      'reason is required and must be 300 characters or fewer.',
      400,
      'GROWTH_OS_INVALID_REASON',
    );
  }
  return normalized;
}

async function mutateVia({
  actorUserId, shopId, action, reason, resourceType, run, ipAddress, userAgent, metadata = {}, idempotency = null,
}) {
  const normalizedReason = redactSecretiveValues(assertReason(reason));
  const { sequelize } = require('../../utils/database/database-setup');
  const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
  return sequelize.transaction(async (transaction) => {
    let idempotencyRecord = null;
    if (idempotency) {
      const { IdempotencyKey } = require('../entities');
      const [record, created] = await IdempotencyKey.findOrCreate({
        where: { idempotency_key: idempotency.key, shop_id: shopId },
        defaults: {
          user_id: actorUserId,
          endpoint: idempotency.endpoint,
          method: idempotency.method,
          request_hash: idempotency.requestHash,
          response_data: null,
          status_code: null,
        },
        transaction,
      });
      if (!created) {
        if (
          record.user_id !== actorUserId
          || record.endpoint !== idempotency.endpoint
          || record.method !== idempotency.method
          || record.request_hash !== idempotency.requestHash
        ) {
          throw new AppError(
            'The idempotency key was already used for a different credit request.',
            409,
            'GROWTH_OS_IDEMPOTENCY_CONFLICT',
          );
        }
        if (record.response_data === null || record.response_data === undefined) {
          throw new AppError(
            'The credit request with this idempotency key is still being processed.',
            409,
            'GROWTH_OS_IDEMPOTENCY_IN_PROGRESS',
          );
        }
        return record.response_data;
      }
      idempotencyRecord = record;
    }
    const result = await run(transaction);
    await writeGrowthAudit({
      actorUserId,
      shopId,
      action,
      resourceType,
      resourceId: shopId,
      oldValues: result?.before || null,
      newValues: result?.after || null,
      metadata: { ...safeMetadata, reason: normalizedReason },
      ipAddress,
      userAgent,
    }, transaction);
    if (idempotencyRecord) {
      await idempotencyRecord.update({ response_data: result, status_code: 200 }, { transaction });
    }
    return result;
  });
}

function assertIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 255 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new AppError(
      'Idempotency-Key header is required for credit grants.',
      400,
      'GROWTH_OS_IDEMPOTENCY_REQUIRED',
    );
  }
  return key;
}

function creditRequestHash({ shopId, amount, reason }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ shopId, amount, reason }), 'utf8')
    .digest('hex');
}

async function setMerchantStatus({ actorUserId, shopId, active, reason, ipAddress, userAgent }) {
  return mutateVia({
    actorUserId,
    shopId,
    action: 'growth_os:merchant_status_changed',
    reason,
    resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
    ipAddress,
    userAgent,
    run: (transaction) => adminService.setShopStatus(
      shopId,
      active ? 'active' : 'suspended',
      { transaction },
    ),
  });
}

// changeMerchantPlan is intentionally NOT exposed: the only existing plan
// mutation path (subscription.service.updatePlan) is payment-gated merchant
// self-service, and inventing an admin bypass would be a manual billing
// control. Plan visibility remains read-only in Merchant 360. If support
// needs plan changes, a dedicated billing domain service must land first.

async function grantMerchantCredits({ actorUserId, shopId, amount, reason, ipAddress, userAgent, idempotencyKey }) {
  const rawReason = assertReason(reason);
  const normalizedReason = redactSecretiveValues(rawReason);
  return mutateVia({
    actorUserId,
    shopId,
    action: 'growth_os:merchant_credits_granted',
    reason: normalizedReason,
    resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
    ipAddress,
    userAgent,
    metadata: { amount },
    idempotency: {
      key: assertIdempotencyKey(idempotencyKey),
      endpoint: '/api/internal/growth-os/admin/merchants/:shopId/grant-credits',
      method: 'POST',
      requestHash: creditRequestHash({ shopId, amount, reason: rawReason }),
    },
    run: (transaction) => adminService.addCredits(
      shopId,
      amount,
      `growth_os: ${normalizedReason.slice(0, 120)}`,
      { transaction },
    ),
  });
}

async function requestChannelReconnect({
  actorUserId, shopId, channelId, reason, ipAddress, userAgent,
}) {
  return mutateVia({
    actorUserId,
    shopId,
    action: 'growth_os:merchant_channel_reconnect_requested',
    reason,
    resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
    ipAddress,
    userAgent,
    metadata: { channelId },
    run: (transaction) => adminService.markChannelReconnect(shopId, channelId, { transaction }),
  });
}

// Deferred: the shop AI domain service does not accept transaction propagation,
// so Growth OS must not expose this mutation until that domain is transaction-safe.

// ── Platform operations queues (SUPER_ADMIN) ────────────────────────────────

async function getOperations({ windowDays = 7 } = {}) {
  const {
    Shop, Subscription, PaymentTransaction, MetaChannel, Message,
  } = require('../entities');
  const window = Math.min(Math.max(parseInt(windowDays, 10) || 7, 1), 90);
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
  const stuckBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    merchantsTotal,
    newMerchantsWindow,
    subscriptionStates,
    paymentsStuck,
    paymentsFailedWindow,
    metaUnhealthy,
    aiMessagesWindow,
    conversationsWindow,
  ] = await Promise.all([
    Shop.count(),
    Shop.count({ where: { created_at: { [Op.gte]: since } } }),
    Subscription.findAll({ attributes: ['status', literal('COUNT(*)::int AS count')], group: ['status'], raw: true }),
    PaymentTransaction.count({
      where: { status: { [Op.in]: ['pending', 'initiated', 'processing'] }, created_at: { [Op.lt]: stuckBefore } },
    }),
    PaymentTransaction.count({ where: { status: 'failed', created_at: { [Op.gte]: since } } }),
    MetaChannel.count({ where: { status: { [Op.in]: ['TOKEN_EXPIRED', 'REVOKED', 'ERROR'] } } }),
    // AI replies actually sent inside the window (message.created_at), not
    // messages on conversations merely created inside the window.
    Message.count({ where: { sender: 'ai', created_at: { [Op.gte]: since } } }).catch(() => null),
    // Distinct conversations touched by an AI reply inside the window.
    Message.count({
      col: 'conversation_id',
      distinct: true,
      where: { sender: 'ai', created_at: { [Op.gte]: since } },
    }).catch(() => null),
  ]);

  return {
    windowDays: window,
    generatedAt: new Date().toISOString(),
    merchants: {
      total: merchantsTotal,
      newInWindow: newMerchantsWindow,
    },
    subscriptions: subscriptionStates.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {}),
    payments: { stuckOver24h: paymentsStuck, failedInWindow: paymentsFailedWindow },
    meta: { channelsNeedingAttention: metaUnhealthy },
    ai: { messagesInWindow: aiMessagesWindow, conversationsInWindow: conversationsWindow },
    // Growth attention lives on the workspace service; kept separate here so
    // platform and funnel analytics do not mix (§32).
  };
}

// ── Privileged audit browsing (SUPER_ADMIN) ─────────────────────────────────

const PRIVILEGED_RESOURCE_TYPES = Object.freeze([
  'GROWTH_OS_ROLE',
  'GROWTH_OS_USER_ADMIN',
  'growth_os_prospect',
  'GROWTH_OS_ADMIN_MERCHANT',
]);

// Bounded, allowlisted view over AuditLog for growth/ops actions only. This
// reuses the existing cross-shop audit read service and additionally hides
// credential-bearing payload keys (§35: audit must not become a data dump).
async function listPrivilegedAuditLogs({
  search = '', resourceType = '', page = 1, pageSize = 50,
} = {}) {
  const { AuditLog, User } = require('../entities');
  const safeLimit = Math.min(clampPage(pageSize, 50), 100);
  const safePage = clampPage(page, 1);
  const where = { resource_type: { [Op.in]: PRIVILEGED_RESOURCE_TYPES } };
  if (resourceType && PRIVILEGED_RESOURCE_TYPES.includes(resourceType)) {
    where.resource_type = resourceType;
  }
  if (search) {
    where.action = { [Op.iLike]: `%${escapeLike(search)}%` };
  }
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    include: [{ model: User, as: 'user', attributes: ['id', 'full_name'], required: false }],
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      actor: r.user ? { userId: r.user.id, name: r.user.full_name } : null,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      shopId: r.shop_id,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
      oldValueCount: r.old_values ? Object.keys(r.old_values).length : 0,
      newValueCount: r.new_values ? Object.keys(r.new_values).length : 0,
      oldValues: redactSecretiveValues(r.old_values),
      newValues: redactSecretiveValues(r.new_values),
      reason: redactSecretiveValues(r.metadata?.reason || null),
    })),
    total: count,
    page: safePage,
    pageSize: safeLimit,
  };
}

module.exports = {
  listMerchantsAsAdmin,
  listMerchantsAsInsight,
  getMerchant360,
  getMerchantInsight,
  setMerchantStatus,
  grantMerchantCredits,
  requestChannelReconnect,
  getOperations,
  listPrivilegedAuditLogs,
  writeGrowthAudit,
  escapeLike,
  likePattern,
  clampPage,
};
