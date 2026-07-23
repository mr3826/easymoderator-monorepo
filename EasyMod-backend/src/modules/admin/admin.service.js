'use strict';

const { Op, fn, col, where: sequelizeWhere } = require('sequelize');
const {
  Shop, Subscription, Message, Order, MetaChannel, MetaUserIdentity,
  AuditLog, User, Invoice,
} = require('../entities');
const cacheService = require('../../utils/cache.service');
const subscriptionService = require('../subscription/subscription.service');
const metaChannelService = require('../channel-providers/meta-channel.service');
const shopService = require('../shop/shop.service');
const { AppError } = require('../../utils/AppError');

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function likeTerm(value) {
  return `%${String(value).trim().toLowerCase()}%`;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function getDashboard() {
  const cacheKey = 'admin:dashboard';
  const cached = await cacheService.get(cacheKey).catch(() => null);
  if (cached) return cached;

  const since = startOfTodayUTC();
  const [
    totalShops, activeShops, trialShops, suspendedShops,
    messagesToday, aiRepliesToday, ordersToday,
  ] = await Promise.all([
    Shop.count(),
    Subscription.count({ where: { status: 'active' } }),
    Subscription.count({ where: { status: 'trialing' } }),
    Subscription.count({ where: { status: 'suspended' } }),
    Message.count({ where: { created_at: { [Op.gte]: since } } }),
    Message.count({ where: { created_at: { [Op.gte]: since }, sender: 'ai' } }),
    Order.count({ where: { created_at: { [Op.gte]: since } } }),
  ]);

  const data = {
    shops: { total: totalShops, active: activeShops, trial: trialShops, suspended: suspendedShops },
    today: {
      messages: messagesToday,
      aiAutoReplies: aiRepliesToday,
      orders: ordersToday,
      // Phase 2 — no clean source yet. Render as "—" in the UI; never fabricate.
      failedAiReplies: null,
      courierFailures: null,
      estimatedAiCost: null,
      systemErrors: null,
    },
    generatedAt: new Date().toISOString(),
  };
  await cacheService.set(cacheKey, data, 30).catch(() => {});
  return data;
}

async function getMetaIdentityReadiness() {
  const mappingScope = {
    where: {
      page_scoped_user_id: { [Op.ne]: null },
    },
    include: [{
      model: MetaChannel,
      as: 'channel',
      attributes: [],
      required: true,
      where: { status: 'CONNECTED' },
    }],
  };
  const [
    totalConnectedChannels,
    channelsWithValidMappings,
    mostRecentMappingCaptureAt,
  ] = await Promise.all([
    MetaChannel.count({ where: { status: 'CONNECTED' } }),
    MetaUserIdentity.count({
      ...mappingScope,
      distinct: true,
      col: 'channel_id',
    }),
    MetaUserIdentity.max('last_verified_at', mappingScope),
  ]);
  const connectedChannelsMissingMappings = Math.max(
    0,
    totalConnectedChannels - channelsWithValidMappings,
  );

  return {
    totalConnectedChannels,
    channelsWithValidMappings,
    connectedChannelsMissingMappings,
    mostRecentMappingCaptureAt: mostRecentMappingCaptureAt || null,
    ready: connectedChannelsMissingMappings === 0,
  };
}

// ── Shops list ───────────────────────────────────────────────────────────────
async function listShops({ search = '', page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const queryWhere = {};
  const normalizedSearch = String(search || '').trim();
  if (normalizedSearch) {
    const match = { [Op.like]: likeTerm(normalizedSearch) };
    queryWhere[Op.or] = [
      sequelizeWhere(fn('LOWER', col('shop_name')), match),
      sequelizeWhere(fn('LOWER', col('users.email')), match),
      sequelizeWhere(fn('LOWER', col('users.full_name')), match),
    ];
  }

  const { rows, count } = await Shop.findAndCountAll({
    where: queryWhere,
    include: [
      { model: Subscription, as: 'subscription', required: false },
      {
        model: User, as: 'users', required: false,
        through: { attributes: ['role'], where: { role: 'owner' } },
        attributes: ['id', 'full_name', 'email', 'phone'],
      },
    ],
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset,
    distinct: true,
    subQuery: false,
  });

  const shopIds = rows.map((s) => s.id);
  let channelCounts = [];
  if (shopIds.length) {
    channelCounts = await MetaChannel.count({
      where: { shop_id: { [Op.in]: shopIds } },
      group: ['shop_id'],
    }).catch(() => []);
  }
  const channelCountByShop = {};
  (Array.isArray(channelCounts) ? channelCounts : []).forEach((c) => {
    channelCountByShop[c.shop_id] = parseInt(c.count, 10);
  });

  const items = rows.map((shop) => {
    const sub = shop.subscription || {};
    const owner = (shop.users && shop.users[0]) || null;
    return {
      id: shop.id,
      shopName: shop.shop_name || shop.name,
      owner: owner ? { name: owner.full_name, email: owner.email, phone: owner.phone } : null,
      plan: sub.plan_name || null,
      status: sub.status || null,
      trialEndsAt: sub.trial_ends_at || null,
      channelCount: channelCountByShop[shop.id] || 0,
      conversationsUsed: sub.conversations_used ?? null,
      conversationsLimit: sub.conversations_limit ?? null,
      createdAt: shop.created_at,
    };
  });

  return { items, total: count, page: safePage, limit: safeLimit };
}

// ── Shop overview ────────────────────────────────────────────────────────────
async function getShopOverview(shopId) {
  const shop = await Shop.findByPk(shopId, {
    include: [
      { model: Subscription, as: 'subscription', required: false },
      {
        model: User, as: 'users', required: false,
        through: { attributes: ['role'] },
        attributes: ['id', 'full_name', 'email', 'phone'],
      },
    ],
  });
  if (!shop) throw new AppError('Shop not found', 404);

  const sub = shop.subscription || {};
  const owner = (shop.users || []).find((u) => u.UserShop?.role === 'owner') || (shop.users || [])[0] || null;
  const settings = shop.settings || {};

  return {
    shop: {
      id: shop.id,
      shopName: shop.shop_name || shop.name,
      uniqueCode: shop.unique_code,
      isActive: shop.is_active,
      timezone: shop.timezone,
      createdAt: shop.created_at,
    },
    owner: owner ? { id: owner.id, name: owner.full_name, email: owner.email, phone: owner.phone } : null,
    subscription: {
      planName: sub.plan_name || null,
      status: sub.status || null,
      trialEndsAt: sub.trial_ends_at || null,
      currentPeriodEnd: sub.current_period_end || null,
    },
    usage: {
      conversationsUsed: sub.conversations_used ?? null,
      conversationsLimit: sub.conversations_limit ?? null,
      topupBalance: sub.topup_balance ?? 0,
    },
    onboarding: {
      completed: Boolean(settings.onboarding?.completed ?? settings.onboardingCompleted ?? false),
      raw: settings.onboarding || null,
    },
  };
}

// ── Channels (NEVER expose page_access_token_ct) ──────────────────────────────
async function getShopChannels(shopId) {
  const channels = await metaChannelService.listByShop(shopId);
  return channels.map((c) => ({
    id: c.id,
    displayName: c.display_name,
    platform: c.platform,
    status: c.status,
    tokenExpiresAt: c.token_expires_at || null,
    webhookLastVerifiedAt: c.webhook_last_verified_at || null,
    webhookSubscribedFields: c.webhook_subscribed_fields || null,
    lastError: c.last_error || null,
    connectedAt: c.connected_at || null,
    // token field intentionally omitted
  }));
}

// ── Billing read ──────────────────────────────────────────────────────────────
async function getShopBilling(shopId) {
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);

  // Recent invoices + a count of what is still owed, so support can see the exact
  // billing state that gates the AI (suspended = unpaid recurring invoice past due).
  const invoices = await Invoice.findAll({
    where: { shop_id: shopId },
    order: [['created_at', 'DESC']],
    limit: 12,
  });
  const outstanding = invoices
    .filter((i) => i.status === 'pending' || i.status === 'overdue')
    .reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

  return {
    planName: sub.plan_name,
    planCode: sub.plan_code,
    billingCycle: sub.billing_cycle,
    billingModel: sub.billing_model,
    status: sub.status,
    trialStart: sub.current_period_start,
    trialEndsAt: sub.trial_ends_at,
    currentPeriodEnd: sub.current_period_end,
    nextBillingDate: sub.next_billing_date,
    conversationsLimit: sub.conversations_limit,
    conversationsUsed: sub.conversations_used,
    topupBalance: sub.topup_balance,
    // Accrued, not-yet-invoiced overage (cleared when the monthly invoice is cut).
    extraConversations: sub.extra_conversations || 0,
    extraCharge: parseFloat(sub.extra_charge || 0),
    outstandingAmount: outstanding,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      type: i.invoice_type,
      amount: parseFloat(i.amount || 0),
      status: i.status,
      billingPeriod: i.billing_period,
      dueDate: i.due_date,
      paidAt: i.paid_at,
      createdAt: i.created_at,
    })),
    estimatedAiCost: null, // Phase 2
  };
}

// ── Audit logs (cross-shop, filtered) ─────────────────────────────────────────
async function getAuditLogs({ adminUserId, shopId, action, startDate, endDate, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const where = {};
  if (adminUserId) where.user_id = adminUserId;
  if (shopId) where.shop_id = shopId;
  if (action) where.action = action;
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at[Op.gte] = new Date(startDate);
    if (endDate) where.created_at[Op.lte] = new Date(endDate);
  }
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    include: [{ model: User, as: 'user', attributes: ['id', 'full_name', 'email'], required: false }],
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      shopId: r.shop_id,
      admin: r.user ? { id: r.user.id, name: r.user.full_name, email: r.user.email } : null,
      oldValues: r.old_values,
      newValues: r.new_values,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
    })),
    total: count, page: safePage, limit: safeLimit,
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────
// These are thin wrappers over existing services + cache-bust. Audit logging
// happens in the controller (it holds req). Each returns { before, after }.
const SUBSCRIPTION_STATUS_CACHE_KEY = 'subscription:status';

async function bustSubscriptionStatusCache(shopId) {
  await cacheService.deleteForShop(shopId, SUBSCRIPTION_STATUS_CACHE_KEY).catch(() => {});
}

async function setShopStatus(shopId, status) {
  if (!['suspended', 'active'].includes(status)) throw new AppError('status must be suspended|active', 400);
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);
  const before = { status: sub.status };
  await sub.update({ status });
  await bustSubscriptionStatusCache(shopId);
  return { before, after: { status } };
}

async function extendTrial(shopId, days) {
  const n = parseInt(days, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 90) throw new AppError('days must be 1..90', 400);
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);
  const base = sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date()
    ? new Date(sub.trial_ends_at) : new Date();
  const newEnd = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
  const before = { trial_ends_at: sub.trial_ends_at, status: sub.status };
  await sub.update({ trial_ends_at: newEnd, status: 'trialing' });
  await bustSubscriptionStatusCache(shopId);
  return { before, after: { trial_ends_at: newEnd, status: 'trialing' } };
}

async function addCredits(shopId, amount, reason = 'admin_grant') {
  const n = parseInt(amount, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) throw new AppError('amount must be 1..100000', 400);
  const beforeSub = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['topup_balance'] });
  await subscriptionService.grantBonusConversations(shopId, n, reason);
  const afterSub = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['topup_balance'] });
  return {
    before: { topup_balance: beforeSub?.topup_balance ?? null },
    after: { topup_balance: afterSub?.topup_balance ?? null, granted: n },
  };
}

async function changePlan(shopId, adminUserId, planData) {
  const sub = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['plan_name', 'plan_code'] });
  const before = { plan_name: sub?.plan_name, plan_code: sub?.plan_code };
  const updated = await subscriptionService.updatePlan(shopId, adminUserId, planData);
  return { before, after: { plan_name: updated?.plan_name ?? planData.plan_name, plan_code: planData.plan_code } };
}

async function markChannelReconnect(shopId, channelId) {
  const channels = await metaChannelService.listByShop(shopId);
  const ch = channels.find((c) => c.id === channelId);
  if (!ch) throw new AppError('Channel not found for this shop', 404);
  const before = { status: ch.status };
  await metaChannelService.updateStatus(channelId, 'TOKEN_EXPIRED', 'Reconnect requested by admin');
  return { before, after: { status: 'TOKEN_EXPIRED' } };
}

/**
 * EMERGENCY: hard-stop a shop's AI. Channel settings override shop settings in
 * both the worker Guard 4 and the Policy Engine draftMode rule, so we set
 * automation_mode=MANUAL on EVERY channel, plus shop-level for UI consistency.
 */
async function emergencyDisableAi(shopId, adminUserId) {
  const channels = await metaChannelService.listByShop(shopId);
  const before = { channels: [] };
  for (const ch of channels) {
    let prevMode = null;
    try { prevMode = (await metaChannelService.getSettings(ch.id))?.automation_mode ?? null; } catch { /* ignore */ }
    before.channels.push({ channelId: ch.id, automation_mode: prevMode });
    await metaChannelService.updateSettings(ch.id, { automation_mode: 'MANUAL' });
  }
  // shop-level (the worker reads getShopAiSettings as the base layer)
  await shopService.updateShopAiSettings(shopId, adminUserId, { automation_mode: 'MANUAL' });
  return { before, after: { automation_mode: 'MANUAL', channelsAffected: channels.length } };
}

module.exports = {
  // reads
  getDashboard, getMetaIdentityReadiness, listShops, getShopOverview,
  getShopChannels, getShopBilling, getAuditLogs,
  // mutations
  setShopStatus, extendTrial, addCredits, changePlan, markChannelReconnect, emergencyDisableAi,
};
