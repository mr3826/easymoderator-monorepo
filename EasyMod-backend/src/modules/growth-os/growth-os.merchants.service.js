'use strict';

// Admin Control Plane merchant surface (SUPER_ADMIN) + Growth-internal
// masked merchant insight (GROWTH_USER). Reads compose canonical records;
// mutations delegate to the existing admin/domain services and never touch
// tables directly. The two view builders are separated on purpose: growth
// insight output must not absorb admin diagnostics.

const { Op, fn, col, literal } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const adminService = require('../admin/admin.service');

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
    await AuditLog.create({
      user_id: actorUserId,
      shop_id: shopId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_values: oldValues || null,
      new_values: newValues || null,
      metadata: { source: 'growth_os_admin_plane', ...metadata },
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
    attributes: ['id', 'shop_name', 'name', 'created_at'],
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
      attributes: ['linked_shop_id', 'business_name'],
      where: { linked_shop_id: { [Op.in]: shopIds } },
    }),
  ]) : [[], []];
  const connectedSet = new Set(connected.map((c) => c.shop_id));
  const prospectsByShop = new Map();
  for (const p of linked) {
    if (!prospectsByShop.has(p.linked_shop_id)) prospectsByShop.set(p.linked_shop_id, []);
    prospectsByShop.get(p.linked_shop_id).push(p.business_name);
  }

  return {
    items: rows.map((shop) => {
      const settings = shop.settings || {};
      const activation = settings.activation || {};
      return {
        shopId: shop.id,
        merchantName: shop.shop_name || shop.name,
        signupDate: shop.created_at,
        planName: shop.subscription?.plan_name || null,
        activatedAt: activation.activated_at || null,
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
      attributes: ['id', 'business_name', 'status', 'source', 'owner_user_id', 'linked_at'],
      limit: 10,
    }),
  ]);

  const shop = await Shop.findByPk(shopId, { attributes: ['settings'] });
  const settings = shop?.settings || {};

  return {
    overview: {
      ...overview,
      activation: {
        activatedAt: settings.activation?.activated_at || null,
        firstConversationId: settings.activation?.first_conversation_id || null,
      },
      ai: {
        configured: Boolean(settings.ai),
        automationMode: settings.ai?.automation_mode ?? null,
        draftModeEnabled: settings.ai?.draft_mode ?? null,
      },
      lastActivityAt: await Session.max('updated_at', { where: { shop_id: shopId } }).catch(() => null),
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
    attributes: ['id', 'shop_name', 'name', 'created_at', 'settings'],
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
      attributes: ['id', 'business_name', 'status', 'source', 'created_at'],
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
      activatedAt: settings.activation?.activated_at || null,
      state: settings.activation?.activated_at ? 'activated' : 'not_activated',
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
  actorUserId, shopId, action, reason, resourceType, run, ipAddress, userAgent, metadata = {},
}) {
  const normalizedReason = assertReason(reason);
  const { sequelize } = require('../../utils/database/database-setup');
  const result = await run();
  await sequelize.transaction((transaction) => writeGrowthAudit({
    actorUserId,
    shopId,
    action,
    resourceType,
    resourceId: shopId,
    oldValues: result?.before || null,
    newValues: result?.after || null,
    metadata: { reason, ...metadata },
    ipAddress,
    userAgent,
  }, transaction));
  return result;
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
    run: () => adminService.setShopStatus(shopId, active ? 'active' : 'suspended'),
  });
}

// changeMerchantPlan is intentionally NOT exposed: the only existing plan
// mutation path (subscription.service.updatePlan) is payment-gated merchant
// self-service, and inventing an admin bypass would be a manual billing
// control. Plan visibility remains read-only in Merchant 360. If support
// needs plan changes, a dedicated billing domain service must land first.

async function grantMerchantCredits({ actorUserId, shopId, amount, reason, ipAddress, userAgent }) {
  return mutateVia({
    actorUserId,
    shopId,
    action: 'growth_os:merchant_credits_granted',
    reason,
    resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
    ipAddress,
    userAgent,
    metadata: { amount },
    run: () => adminService.addCredits(shopId, amount, `growth_os: ${assertReason(reason).slice(0, 120)}`),
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
    run: () => adminService.markChannelReconnect(shopId, channelId),
  });
}

async function emergencyDisableMerchantAi({ actorUserId, shopId, reason, ipAddress, userAgent }) {
  return mutateVia({
    actorUserId,
    shopId,
    action: 'growth_os:merchant_ai_disabled',
    reason,
    resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
    ipAddress,
    userAgent,
    run: () => adminService.emergencyDisableAi(shopId, actorUserId),
  });
}

// ── Platform operations queues (SUPER_ADMIN) ────────────────────────────────

async function getOperations({ windowDays = 7 } = {}) {
  const {
    Shop, Subscription, PaymentTransaction, MetaChannel, Message, Conversation,
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
    Message.count({
      include: [{ model: Conversation, as: 'conversation', required: true, where: { created_at: { [Op.gte]: since } } }],
      where: { sender: 'ai' },
    }).catch(() => null),
    Conversation.count({ where: { created_at: { [Op.gte]: since } } }),
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

function redactSecretiveValues(value) {
  if (!value) return value;
  const SENSITIVE_KEY = /(password|token|secret|otp|totp|authorization|cookie|credential)/i;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : walk(child);
      }
      return out;
    }
    return node;
  };
  return walk(value);
}

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
      reason: r.metadata?.reason || null,
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
  emergencyDisableMerchantAi,
  getOperations,
  listPrivilegedAuditLogs,
  writeGrowthAudit,
  escapeLike,
  likePattern,
  clampPage,
};
