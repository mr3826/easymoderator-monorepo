'use strict';

// Growth workspace read models: operational home, funnel analytics, and the
// unified internal search. Every metric here is derived from source rows the
// current code actually writes (prospect ledger, follow-ups, canonical
// shops/users/Meta channels). Nothing approximates CAC, cohort retention, or
// outreach — those source events do not exist yet (§31).

const { Op, fn, col, literal } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const { resolveProspectScope } = require('./growth-os.prospect.scope');
const { escapeLike, likePattern } = require('./growth-os.merchants.service');

const HOME_WINDOW_DAYS = 7;
const ATTENTION_WINDOW_DAYS = 30;

function getModels() {
  return require('../entities');
}

function dayFloor(daysBack) {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
}

function medianSeconds(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ── Internal homepage (My Work + attention queues) ──────────────────────────

async function getHome({ access, userId, isSuperAdmin }) {
  const {
    GrowthOsProspect, GrowthOsFollowup, AuditLog, User,
    Shop, MetaChannel, PaymentTransaction, Subscription,
  } = getModels();
  const scope = resolveProspectScope(access, userId);
  const baseWhere = scope.where;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const now = new Date();

  const followupScopeInclude = scope.kind === 'all'
    ? []
    : [{
      model: GrowthOsProspect,
      as: 'prospect',
      required: true,
      where: scope.where,
    }];

  const [
    followupsMineOverdue,
    mineFollowupsAll,
    myProspects,
    newLeadsWindow,
    qualifiedNow,
    onboardingNow,
    convertedWindow,
    staleOnboarding,
    overdueWindow,
  ] = await Promise.all([
    GrowthOsFollowup.count({ where: { status: 'open', owner_user_id: userId, due_at: { [Op.lt]: dayStart } } }),
    GrowthOsFollowup.count({ where: { status: 'open', owner_user_id: userId } }),
    GrowthOsProspect.count({ where: { ...baseWhere, owner_user_id: userId, status: { [Op.ne]: 'merged' } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'new', created_at: { [Op.gte]: dayFloor(HOME_WINDOW_DAYS) } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'qualified' } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'onboarding' } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'converted', status_changed_at: { [Op.gte]: dayFloor(HOME_WINDOW_DAYS) } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'onboarding', status_changed_at: { [Op.lt]: dayFloor(15) } } }),
    GrowthOsFollowup.count({ where: { status: 'open', due_at: { [Op.lt]: now } }, include: followupScopeInclude }),
  ]);

  const home = {
    generatedAt: new Date().toISOString(),
    myWork: {
      followupsOverdueMine: followupsMineOverdue,
      followupsOpenMine: mineFollowupsAll,
      prospectsAssignedToMe: myProspects,
    },
    growthAttention: {
      newLeadsLast7d: newLeadsWindow,
      qualifiedOpen: qualifiedNow,
      onboardingOpen: onboardingNow,
      onboardingStalledOver15d: staleOnboarding,
      convertedLast7d: convertedWindow,
      followupsOverdueInScope: overdueWindow,
    },
  };

  if (isSuperAdmin) {
    const [
      merchantsTotal,
      metaUnhealthy,
      paymentsStuck,
      suspended,
      recentPrivileged,
    ] = await Promise.all([
      Shop.count(),
      MetaChannel.count({ where: { status: { [Op.in]: ['TOKEN_EXPIRED', 'REVOKED', 'ERROR'] } } }),
      PaymentTransaction.count({
        where: { status: { [Op.in]: ['pending', 'initiated', 'processing'] }, created_at: { [Op.lt]: dayFloor(1) } },
      }),
      Subscription.count({ where: { status: 'suspended' } }),
      AuditLog.findAll({
        where: {
          resource_type: { [Op.in]: ['GROWTH_OS_ROLE', 'GROWTH_OS_USER_ADMIN', 'GROWTH_OS_ADMIN_MERCHANT'] },
        },
        order: [['created_at', 'DESC']],
        limit: 8,
        include: [{ model: User, as: 'user', attributes: ['id', 'full_name'], required: false }],
      }),
    ]);
    home.merchantAttention = { merchantsTotal };
    home.platformAttention = {
      metaChannelsUnhealthy: metaUnhealthy,
      paymentTransactionsStuckOver24h: paymentsStuck,
      subscriptionsSuspended: suspended,
    };
    home.recentPrivilegedActions = recentPrivileged.map((row) => ({
      id: row.id,
      actor: row.user ? { userId: row.user.id, name: row.user.full_name } : null,
      action: row.action,
      resourceType: row.resource_type,
      createdAt: row.created_at,
      reason: row.metadata?.reason || null,
    }));
  }

  return home;
}

// ── Growth funnel analytics ─────────────────────────────────────────────────

async function getGrowthAnalytics({ access, userId, windowDays = 90 }) {
  const window = Math.min(Math.max(parseInt(windowDays, 10) || 90, 7), 365);
  const since = dayFloor(window);
  const { GrowthOsProspect, GrowthOsProspectEvent } = getModels();
  const scope = resolveProspectScope(access, userId);
  const baseWhere = scope.where;

  const [statusRows, sourceRows, convertedBySource, firstContactLags, activationLags, disqualifiedCount] = await Promise.all([
    GrowthOsProspect.findAll({
      attributes: ['status', literal('COUNT(*)::int AS count')],
      where: { ...baseWhere, created_at: { [Op.gte]: since } },
      group: ['status'],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['source', literal('COUNT(*)::int AS count')],
      where: { ...baseWhere, created_at: { [Op.gte]: since } },
      group: ['source'],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['source', literal('COUNT(*)::int AS count')],
      where: { ...baseWhere, status: 'converted', created_at: { [Op.gte]: since } },
      group: ['source'],
      raw: true,
    }),
    // Seconds between prospect creation and its first status-change event.
    GrowthOsProspectEvent.findAll({
      attributes: [
        [fn('MIN', col('GrowthOsProspectEvent.created_at')), 'first_change_at'],
        [col('prospect.created_at'), 'prospect_created_at'],
      ],
      include: [{
        association: 'prospect',
        required: true,
        where: { ...baseWhere, created_at: { [Op.gte]: since } },
        attributes: [],
      }],
      where: {
        event_type: 'status_changed',
        to_value: { [Op.in]: ['contacted', 'qualifying', 'qualified', 'onboarding', 'converted'] },
      },
      group: ['prospect_id', 'prospect.created_at'],
      limit: 500,
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['created_at', 'status_changed_at'],
      where: { ...baseWhere, status: 'converted', created_at: { [Op.gte]: since } },
      limit: 500,
      raw: true,
    }),
    GrowthOsProspect.count({
      where: { ...baseWhere, status: { [Op.in]: ['disqualified', 'unreachable'] }, created_at: { [Op.gte]: since } },
    }),
  ]);

  const statusCounts = statusRows.reduce((acc, row) => { acc[row.status] = Number(row.count); return acc; }, {});
  const converted = statusCounts.converted || 0;
  const created = statusRows.reduce((sum, row) => sum + Number(row.count), 0);

  const firstContactSeconds = firstContactLags
    .map((row) => (new Date(row.first_change_at).getTime() - new Date(row.prospect_created_at).getTime()) / 1000)
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);

  const activationSeconds = activationLags
    .map((row) => (new Date(row.status_changed_at).getTime() - new Date(row.created_at).getTime()) / 1000)
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);

  return {
    windowDays: window,
    generatedAt: new Date().toISOString(),
    funnel: {
      created,
      contactedOrBeyond: (statusCounts.contacted || 0) + (statusCounts.qualifying || 0)
        + (statusCounts.qualified || 0) + (statusCounts.onboarding || 0) + (statusCounts.converted || 0),
      qualified: (statusCounts.qualified || 0) + (statusCounts.onboarding || 0) + (statusCounts.converted || 0),
      onboarding: statusCounts.onboarding || 0,
      activated: converted,
      lost: disqualifiedCount,
    },
    conversion: {
      createdToActivated: created > 0 ? Math.round((converted / created) * 1000) / 10 : null,
    },
    byStatus: statusCounts,
    bySource: sourceRows.reduce((acc, row) => { acc[row.source] = Number(row.count); return acc; }, {}),
    activatedBySource: convertedBySource.reduce((acc, row) => { acc[row.source] = Number(row.count); return acc; }, {}),
    timing: {
      medianHoursToFirstContact: firstContactSeconds.length
        ? Math.round((medianSeconds(firstContactSeconds) / 3600) * 10) / 10
        : null,
      medianHoursCreatedToActivated: activationSeconds.length
        ? Math.round((medianSeconds(activationSeconds) / 3600) * 10) / 10
        : null,
    },
    // Metrics intentionally NOT shown: outreach volume, reply rate, CAC,
    // cohort retention — their source events do not exist yet (§31).
    notAvailable: ['outreach_volume', 'reply_rate', 'cac', 'cohort_retention'],
  };
}

// ── Global internal search (role-redacted) ─────────────────────────────────

async function globalSearch({ access, userId, query, isSuperAdmin }) {
  const term = String(query || '').trim();
  if (term.length < 2) {
    throw new AppError('query must be at least 2 characters.', 400, 'GROWTH_OS_SEARCH_QUERY_TOO_SHORT');
  }
  if (term.length > 100) {
    throw new AppError('query must be 100 characters or fewer.', 400, 'GROWTH_OS_SEARCH_QUERY_INVALID');
  }
  const pattern = likePattern(term);
  const limit = 10;
  const { GrowthOsProspect, User, Shop, Subscription } = getModels();

  const out = { prospects: [], merchants: [], users: [] };

  const prospectScope = resolveProspectScope(access, userId);
  const prospectOr = [
    { normalized_business_name: { [Op.iLike]: pattern } },
  ];
  if (term.includes('@')) {
    prospectOr.push({ normalized_email: term.toLowerCase() });
  }
  const phoneDigits = term.replace(/[^0-9+]/g, '');
  if (phoneDigits.length >= 7) {
    prospectOr.push({ normalized_phone: { [Op.iLike]: `%${escapeLike(phoneDigits.slice(-10))}%` } });
  }
  const prospectWhere = { ...prospectScope.where, [Op.or]: prospectOr };
  const prospectRows = await GrowthOsProspect.findAll({
    where: prospectWhere,
    attributes: ['id', 'business_name', 'status', 'source', 'owner_user_id', 'contact_name', 'contact_phone', 'contact_email'],
    order: [['created_at', 'DESC']],
    limit,
  });
  out.prospects = prospectRows.map((row) => {
    const item = {
      prospectId: row.id,
      businessName: row.business_name,
      status: row.status,
      source: row.source,
      ownerUserId: row.owner_user_id,
    };
    if (!prospectScope.redacted) {
      item.contactName = row.contact_name;
      item.contactPhone = row.contact_phone;
      item.contactEmail = row.contact_email;
    }
    return item;
  });

  if (isSuperAdmin) {
    const [userRows, shopRows] = await Promise.all([
      User.findAll({
        where: {
          [Op.or]: [
            { email: { [Op.iLike]: pattern } },
            { full_name: { [Op.iLike]: pattern } },
          ],
        },
        attributes: ['id', 'email', 'full_name'],
        order: [['created_at', 'DESC']],
        limit,
      }),
      Shop.findAll({
        where: {
          [Op.or]: [
            { shop_name: { [Op.iLike]: pattern } },
            { unique_code: { [Op.iLike]: `${escapeLike(term)}%` } },
          ],
        },
        include: [
          {
            model: User,
            as: 'users',
            required: false,
            through: { attributes: [], where: { role: 'owner', is_active: true } },
            attributes: ['id', 'full_name', 'email'],
          },
          {
            model: Subscription,
            as: 'subscription',
            required: false,
            attributes: ['plan_name', 'status'],
          },
        ],
        attributes: ['id', 'shop_name', 'name', 'unique_code', 'created_at'],
        order: [['created_at', 'DESC']],
        limit,
        subQuery: false,
      }),
    ]);
    out.users = userRows.map((row) => ({ userId: row.id, email: row.email, displayName: row.full_name }));
    out.merchants = shopRows.map((shop) => {
      const owner = shop.users?.[0] || null;
      return {
        shopId: shop.id,
        merchantName: shop.shop_name || shop.name,
        uniqueCode: shop.unique_code,
        planName: shop.subscription?.plan_name || null,
        subscriptionStatus: shop.subscription?.status || null,
        owner: owner ? { name: owner.full_name, email: owner.email } : null,
      };
    });
    return out;
  }

  if (access?.permissions?.includes('growth_os.merchants.read_insight')) {
    const shopRows = await Shop.findAll({
      where: { shop_name: { [Op.iLike]: pattern } },
      include: [{
        model: Subscription,
        as: 'subscription',
        required: false,
        attributes: ['plan_name'],
      }],
      attributes: ['id', 'shop_name', 'name', 'created_at', 'settings'],
      order: [['created_at', 'DESC']],
      limit,
      subQuery: false,
    });
    out.merchants = shopRows.map((shop) => ({
      shopId: shop.id,
      merchantName: shop.shop_name || shop.name,
      signupDate: shop.created_at,
      planName: shop.subscription?.plan_name || null,
      activated: Boolean(shop.settings?.activation?.activated_at),
    }));
  }

  return out;
}

module.exports = {
  getHome,
  getGrowthAnalytics,
  globalSearch,
  HOME_WINDOW_DAYS,
  ATTENTION_WINDOW_DAYS,
};
