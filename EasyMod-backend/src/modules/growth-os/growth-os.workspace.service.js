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
const { getBusinessDayBounds } = require('./growth-os.time');

const HOME_WINDOW_DAYS = 7;

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

  const generatedAt = new Date();
  const dayBounds = getBusinessDayBounds(generatedAt);
  const dayStart = dayBounds.start;
  const dayEnd = dayBounds.end;
  const now = generatedAt;
  const attentionSince = new Date(generatedAt.getTime() - HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const stalledBefore = new Date(generatedAt.getTime() - 15 * 24 * 60 * 60 * 1000);

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
    unassignedQualified,
    onboardingNow,
    convertedWindow,
    staleOnboarding,
    stalledQualified,
    overdueWindow,
    dueTodayWindow,
  ] = await Promise.all([
    GrowthOsFollowup.count({
      where: { status: 'open', owner_user_id: userId, due_at: { [Op.lt]: now } },
      include: followupScopeInclude,
    }),
    GrowthOsFollowup.count({
      where: { status: 'open', owner_user_id: userId },
      include: followupScopeInclude,
    }),
    GrowthOsProspect.count({ where: { ...baseWhere, owner_user_id: userId, status: { [Op.ne]: 'merged' } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'new', created_at: { [Op.gte]: attentionSince, [Op.lte]: now } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'qualified' } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'qualified', owner_user_id: { [Op.is]: null } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'onboarding' } }),
    // Canonical activated population (same predicate as the `activated=true`
    // list filter and funnel.activated): converted with a currently active
    // linked shop.
    GrowthOsProspect.count({
      where: {
        ...baseWhere,
        status: 'converted',
        linked_shop_id: { [Op.ne]: null },
        status_changed_at: { [Op.gte]: attentionSince, [Op.lte]: now },
      },
      include: [{ model: Shop, as: 'linkedShop', required: true, attributes: [], where: { is_active: true } }],
    }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'onboarding', status_changed_at: { [Op.lt]: stalledBefore } } }),
    GrowthOsProspect.count({ where: { ...baseWhere, status: 'qualified', status_changed_at: { [Op.lt]: stalledBefore } } }),
    GrowthOsFollowup.count({ where: { status: 'open', due_at: { [Op.lt]: now } }, include: followupScopeInclude }),
    GrowthOsFollowup.count({
      where: { status: 'open', due_at: { [Op.gte]: dayStart, [Op.lt]: dayEnd } },
      include: followupScopeInclude,
    }),
  ]);

  const home = {
    generatedAt: generatedAt.toISOString(),
    windows: {
      attentionSince: attentionSince.toISOString(),
      attentionUntil: now.toISOString(),
      stalledBefore: stalledBefore.toISOString(),
      businessTimeZone: dayBounds.timeZone,
    },
    myWork: {
      followupsOverdueMine: followupsMineOverdue,
      followupsOpenMine: mineFollowupsAll,
      prospectsAssignedToMe: myProspects,
    },
    growthAttention: {
      newLeadsLast7d: newLeadsWindow,
      qualifiedOpen: qualifiedNow,
      unassignedQualified,
      onboardingOpen: onboardingNow,
      onboardingStalledOver15d: staleOnboarding,
      qualifiedStalledOver15d: stalledQualified,
      convertedLast7d: convertedWindow,
      followupsOverdueInScope: overdueWindow,
      followupsDueTodayInScope: dueTodayWindow,
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

const NOT_AVAILABLE_METRICS = Object.freeze([
  'reply_rate',
  'cac',
  'cohort_retention',
]);

function medianHours(values) {
  const seconds = medianSeconds(values);
  return seconds === null ? null : Math.round((seconds / 3600) * 10) / 10;
}

function eventTimesByProspect(rows, eventType, toValue) {
  const times = new Map();
  for (const row of rows) {
    if (row.event_type !== eventType || (toValue && row.to_value !== toValue)) continue;
    const at = new Date(row.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    const previous = times.get(row.prospect_id);
    if (!previous || at < previous) times.set(row.prospect_id, at);
  }
  return times;
}

function durationHours(prospectRows, eventTimes, cohortField = 'source_recorded_at') {
  return prospectRows.map((row) => {
    const cohort = new Date(row[cohortField] || row.created_at).getTime();
    const eventAt = eventTimes.get(row.id);
    return Number.isFinite(cohort) && Number.isFinite(eventAt) && eventAt >= cohort
      ? (eventAt - cohort) / 1000
      : null;
  }).filter((value) => value !== null);
}

async function getGrowthAnalytics({ access, userId, windowDays = 90 }) {
  const window = Math.min(Math.max(parseInt(windowDays, 10) || 90, 7), 365);
  const since = dayFloor(window);
  const until = new Date();
  const {
    GrowthOsProspect, GrowthOsProspectEvent, GrowthOsFollowup, Shop, User,
  } = getModels();
  const scope = resolveProspectScope(access, userId);
  const baseWhere = { ...scope.where, status: { [Op.ne]: 'merged' } };
  const cohortWhere = { ...baseWhere, source_recorded_at: { [Op.gte]: since, [Op.lte]: until } };
  const eventInclude = [{
    association: 'prospect',
    required: true,
    where: cohortWhere,
    attributes: [],
  }];

  const [statusRows, sourceRows, activatedRows, prospectRows, eventRows, lostRows] = await Promise.all([
    GrowthOsProspect.findAll({
      attributes: ['status', literal('COUNT(*)::int AS count')],
      where: cohortWhere,
      group: ['status'],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['source', literal('COUNT(*)::int AS count')],
      where: cohortWhere,
      group: ['source'],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['id', 'source', 'source_recorded_at', 'created_at'],
      where: { ...cohortWhere, status: 'converted', linked_shop_id: { [Op.ne]: null } },
      include: [{ model: Shop, as: 'linkedShop', required: true, attributes: [], where: { is_active: true } }],
      order: [['source_recorded_at', 'ASC'], ['id', 'ASC']],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['id', 'source', 'source_recorded_at', 'created_at', 'status', 'disqualified_reason'],
      where: cohortWhere,
      order: [['source_recorded_at', 'ASC'], ['id', 'ASC']],
      raw: true,
    }),
    // Ordered, uncapped event read. Aggregation below is deterministic and does
    // not silently discard prospects after an arbitrary first 500 rows.
    GrowthOsProspectEvent.findAll({
      attributes: ['prospect_id', 'event_type', 'to_value', 'created_at'],
      include: eventInclude,
      where: { event_type: { [Op.in]: ['status_changed', 'followup_created', 'activated'] } },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: ['status', 'disqualified_reason'],
      where: { ...cohortWhere, status: { [Op.in]: ['disqualified', 'unreachable'] } },
      raw: true,
    }),
  ]);

  // Core value-loop telemetry: follow-up discipline, owner performance, and
  // unassigned aging, aggregated server-side from the existing ledger only.
  const [
    followupTotal, followupOpen, followupCompleted, followupCancelled,
    followupOnTime, followupLate, followupOverdueOpen, ownerRows, unassignedRows,
  ] = await Promise.all([
    GrowthOsFollowup.count(),
    GrowthOsFollowup.count({ where: { status: 'open' } }),
    GrowthOsFollowup.count({ where: { status: 'completed' } }),
    GrowthOsFollowup.count({ where: { status: 'cancelled' } }),
    GrowthOsFollowup.count({
      where: { status: 'completed', completed_at: { [Op.lte]: col('due_at') } },
    }),
    GrowthOsFollowup.count({
      where: { status: 'completed', completed_at: { [Op.gt]: col('due_at') } },
    }),
    GrowthOsFollowup.count({ where: { status: 'open', due_at: { [Op.lt]: until } } }),
    GrowthOsProspect.findAll({
      attributes: [
        [col('owner_user_id'), 'ownerUserId'],
        [literal('COUNT(*)::int'), 'created'],
        [literal("COUNT(*) FILTER (WHERE status IN ('qualified','onboarding','converted'))::int"), 'qualified'],
        [literal("COUNT(*) FILTER (WHERE status = 'converted')::int"), 'converted'],
      ],
      where: { ...cohortWhere, owner_user_id: { [Op.ne]: null } },
      group: ['owner_user_id'],
      raw: true,
    }),
    GrowthOsProspect.findAll({
      attributes: [
        [literal('COUNT(*)::int'), 'openCount'],
        [fn('MIN', col('source_recorded_at')), 'oldestAt'],
      ],
      where: {
        ...baseWhere,
        owner_user_id: null,
        status: { [Op.in]: ['new', 'contacted', 'qualifying', 'qualified', 'onboarding'] },
      },
      raw: true,
    }),
  ]);
  const ownerUserIds = ownerRows.map((row) => row.ownerUserId).filter(Boolean);
  const ownerUsers = ownerUserIds.length
    ? await User.findAll({
      where: { id: ownerUserIds },
      attributes: ['id', 'full_name', 'email'],
      raw: true,
    })
    : [];
  const ownerById = new Map(ownerUsers.map((user) => [user.id, user]));
  const statusCounts = statusRows.reduce((acc, row) => { acc[row.status] = Number(row.count); return acc; }, {});
  const created = prospectRows.length;
  const activated = activatedRows.length;
  const firstContact = eventTimesByProspect(eventRows, 'status_changed');
  const qualification = eventTimesByProspect(eventRows, 'status_changed', 'qualified');
  const followup = eventTimesByProspect(eventRows, 'followup_created');
  const lostReasons = lostRows.reduce((acc, row) => {
    const reason = row.disqualified_reason || (row.status === 'unreachable' ? 'unreachable' : 'unspecified');
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const sourceToActivation = activatedRows.reduce((acc, row) => {
    acc[row.source] = (acc[row.source] || 0) + 1;
    return acc;
  }, {});
  const sourceCounts = sourceRows.reduce((acc, row) => { acc[row.source] = Number(row.count); return acc; }, {});
  const sourceRates = Object.fromEntries(Object.entries(sourceCounts).map(([source, count]) => [
    source,
    count > 0 ? Math.round(((sourceToActivation[source] || 0) / count) * 1000) / 10 : null,
  ]));

  return {
    windowDays: window,
    generatedAt: new Date().toISOString(),
    funnel: {
      created,
      contactedOrBeyond: (statusCounts.contacted || 0) + (statusCounts.qualifying || 0)
        + (statusCounts.qualified || 0) + (statusCounts.onboarding || 0) + (statusCounts.converted || 0),
      qualified: (statusCounts.qualified || 0) + (statusCounts.onboarding || 0) + (statusCounts.converted || 0),
      onboarding: statusCounts.onboarding || 0,
      activated,
      lost: lostRows.length,
    },
    conversion: {
      createdToActivated: created > 0 ? Math.round((activated / created) * 1000) / 10 : null,
    },
    byStatus: statusCounts,
    bySource: sourceCounts,
    activatedBySource: sourceToActivation,
    sourceToActivation: sourceRates,
    lostReasons,
    timing: {
      medianHoursToFirstContact: medianHours(durationHours(prospectRows, firstContact)),
      medianHoursToQualification: medianHours(durationHours(prospectRows, qualification)),
      medianHoursToFirstFollowup: medianHours(durationHours(prospectRows, followup)),
       medianHoursCreatedToActivated: medianHours(durationHours(activatedRows, eventTimesByProspect(eventRows, 'activated', 'converted'))),
    },
    leadToActivation: created > 0 ? Math.round((activated / created) * 1000) / 10 : null,
    followupDiscipline: {
      total: followupTotal,
      open: followupOpen,
      completed: followupCompleted,
      cancelled: followupCancelled,
      completedOnTime: followupOnTime,
      completedLate: followupLate,
      overdueOpen: followupOverdueOpen,
      onTimeRatePct: followupCompleted > 0
        ? Math.round((followupOnTime / followupCompleted) * 1000) / 10
        : null,
    },
    byOwner: ownerRows
      .map((row) => {
        const user = ownerById.get(row.ownerUserId);
        return {
          ownerUserId: row.ownerUserId,
          displayName: user ? (user.full_name || user.email) : 'Former operator (account removed)',
          created: Number(row.created),
          qualified: Number(row.qualified),
          converted: Number(row.converted),
          qualificationRatePct: Number(row.created) > 0
            ? Math.round((Number(row.qualified) / Number(row.created)) * 1000) / 10
            : null,
          activationRatePct: Number(row.created) > 0
            ? Math.round((Number(row.converted) / Number(row.created)) * 1000) / 10
            : null,
        };
      })
      .sort((left, right) => right.created - left.created || String(left.displayName).localeCompare(String(right.displayName))),
    unassigned: (() => {
      const aggregate = unassignedRows[0] || {};
      const openCount = Number(aggregate.openCount || 0);
      const oldestAt = aggregate.oldestAt ? new Date(aggregate.oldestAt) : null;
      return {
        openCount,
        oldestSourceRecordedAt: oldestAt ? oldestAt.toISOString() : null,
        oldestAgeDays: oldestAt
          ? Math.max(0, Math.floor((until.getTime() - oldestAt.getTime()) / (24 * 60 * 60 * 1000)))
          : null,
      };
    })(),
    notAvailable: NOT_AVAILABLE_METRICS,
     cohort: {
       basis: 'source_recorded_at',
       importedAt: 'created_at',
       eventAt: 'prospect_events.created_at',
       sourceRecordedFrom: since.toISOString(),
       sourceRecordedTo: until.toISOString(),
     },
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
  const normalizedTerm = term.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const normalizedPattern = likePattern(normalizedTerm);
  const limit = 10;
  const { GrowthOsProspect, User, Shop, Subscription } = getModels();

  const out = { prospects: [], merchants: [], users: [] };

  const prospectScope = resolveProspectScope(access, userId);
  const prospectOr = [];
  if (normalizedTerm) {
    prospectOr.push({ normalized_business_name: { [Op.iLike]: normalizedPattern } });
  }
  prospectOr.push(
        { contact_name: { [Op.iLike]: pattern } },
        { contact_phone: { [Op.iLike]: pattern } },
        { contact_email: { [Op.iLike]: pattern } },
        { page_url: { [Op.iLike]: pattern } },
  );
  if (term.includes('@')) {
    prospectOr.push({ normalized_email: term.toLowerCase() });
  }
  const phoneDigits = term.replace(/[^0-9+]/g, '');
  if (phoneDigits.length >= 7) {
    prospectOr.push({ normalized_phone: { [Op.iLike]: `%${escapeLike(phoneDigits.slice(-10))}%` } });
  }
  const prospectWhere = { ...prospectScope.where, status: { [Op.ne]: 'merged' }, [Op.or]: prospectOr };
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
    }));
  }

  return out;
}

module.exports = {
  getHome,
  getGrowthAnalytics,
  globalSearch,
  HOME_WINDOW_DAYS,
};
