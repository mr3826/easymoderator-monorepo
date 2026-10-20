'use strict';

/**
 * LOCAL-ONLY founder review seed for Growth OS Action-First V1.
 *
 * Deliberately separate from the browser E2E fixture path: it never shares
 * emails, tenant/shop codes, or source references with `seed-growth-e2e.js`,
 * requires an explicit GROWTH_REVIEW_MODE=true gate, a disposable database
 * name, and a freshly generated password passed in the environment. The
 * script writes no secret file itself — it prints machine-readable JSON to
 * stdout for the review runner to store in a gitignored local receipt.
 */

if (process.env.GROWTH_REVIEW_MODE !== 'true') {
  console.error('Refusing Growth review seed: GROWTH_REVIEW_MODE=true is required.');
  process.exit(2);
}

const { assertDisposableDatabase } = require('../../tests/helpers/disposable-database');
assertDisposableDatabase(process.env.DATABASE_URL, 'the Growth OS local review seed');

const password = process.env.GROWTH_REVIEW_PASSWORD || '';
if (password.length < 16 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  console.error('Refusing Growth review seed: GROWTH_REVIEW_PASSWORD must be a fresh strong local value (16+ chars, mixed classes).');
  process.exit(2);
}

const { Op } = require('sequelize');
const { sequelize } = require('../utils/database/database-setup');
const {
  AuditLog,
  GrowthOsFollowup,
  GrowthOsNote,
  GrowthOsProspect,
  GrowthOsProspectEvent,
  GrowthOsUserRole,
  MetaChannel,
  Order,
  PaymentTransaction,
  Shop,
  Subscription,
  Tenant,
  User,
  UserShop,
} = require('../modules/entities');
const { hashPassword } = require('../utils/password.util');
const { generateTotpSecret, enableTotp, hotp } = require('../modules/auth/totp.service');
const { normalizeIdentity } = require('../modules/growth-os/growth-os.prospect.identity');

const FIXTURE_VERSION = 'growth-review-v1';
const tenantName = 'Growth OS local review tenant';
const scenarioLabel = (text) => `Local review scenario (synthetic): ${text}`;

const userDefinitions = {
  admin: {
    email: 'growth-review-admin@example.test',
    full_name: 'Review Super Admin',
    phone: '01710000001',
    role: 'SUPER_ADMIN',
    totp: true,
  },
  sales: {
    email: 'growth-review-sales@example.test',
    full_name: 'Review Growth User',
    phone: '01710000002',
    role: 'GROWTH_USER',
    totp: true,
  },
  merchant: {
    email: 'growth-review-merchant@example.test',
    full_name: 'Review Merchant Owner',
    phone: '01710000003',
    role: null,
    shopRole: 'owner',
  },
};

function dhakaNoonToday() {
  const now = new Date();
  const local = new Date(now.getTime() + 6 * 3600 * 1000);
  const dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 6 * 3600 * 1000;
  return new Date(dayStartUtc + 10 * 3600 * 1000);
}

const now = () => new Date();
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);

const shopDefinitions = {
  // Growing operational merchant: suspended subscription and a payment stuck
  // over 24h give the Admin Control landing genuine, canonical backing data.
  ops: {
    unique_code: 'GROWTH-REVIEW-OPS',
    name: 'Meghna Groceries (synthetic operational merchant)',
    is_active: true,
    settings: { fixture: FIXTURE_VERSION, scenario: 'operational-merchant' },
    subscription: { status: 'suspended', planName: 'Growth', planPrice: 4900 },
    payment: { status: 'pending', amount: 4900, createdAtDaysAgo: 3 },
  },
  // Active F-commerce shop whose Facebook channel needs attention.
  fcommerce: {
    unique_code: 'GROWTH-REVIEW-FCOM',
    name: 'Chandke Sareghar (synthetic F-commerce shop)',
    is_active: true,
    settings: { fixture: FIXTURE_VERSION, scenario: 'f-commerce' },
    subscription: { status: 'active', planName: 'Shuru', planPrice: 1490 },
    channel: { status: 'TOKEN_EXPIRED', displayName: 'Chandke Sareghar (test page)', pageId: '120250000000001' },
  },
  // Hobby storefront that reached first AI reply — the activation demo.
  hobby: {
    unique_code: 'GROWTH-REVIEW-HOBBY',
    name: 'Rongdhanu Craft Corner (synthetic hobby seller)',
    is_active: true,
    settings: {
      fixture: FIXTURE_VERSION,
      scenario: 'hobby-storefront',
      first_ai_reply: { at: daysAgo(4).toISOString(), source: FIXTURE_VERSION },
    },
    subscription: { status: 'trialing', planName: 'Shuru', planPrice: 0 },
  },
};

const prospectDefinitions = [
  {
    key: 'hobbyNewUnclaimed',
    businessName: 'রামনগর ফুলের টুকরো (synthetic hobby seller)',
    contactName: 'Synthetic Hobby Owner',
    contactPhone: '01710000011',
    contactEmail: 'growth-review-hobby@example.test',
    source: 'self_signup',
    sourceReference: 'growth-review:hobby-new',
    niche: 'gifts',
    status: 'new',
    owner: null,
    why: 'New unclaimed lead — first contact or assign.',
  },
  {
    key: 'fcQualifiedUnassigned',
    businessName: 'চান্দিনা সরগর F-commerce (synthetic)',
    contactName: 'Synthetic Fc Owner',
    contactPhone: '01710000012',
    contactEmail: 'growth-review-fc@example.test',
    source: 'partner_form',
    sourceReference: 'growth-review:fc-qualified-unassigned',
    niche: 'fashion',
    status: 'qualified',
    statusChangedAt: daysAgo(4),
    owner: null,
    why: 'Qualified but no owner — assign and follow up.',
  },
  {
    key: 'opsQualifiedUnassigned',
    businessName: 'Bhawal Bazaar Store (synthetic)',
    contactName: 'Synthetic Ops Owner',
    contactPhone: '01710000013',
    source: 'inbound_message',
    sourceReference: 'growth-review:ops-qualified-unassigned',
    niche: 'grocery',
    status: 'qualified',
    statusChangedAt: daysAgo(9),
    owner: null,
    why: 'Second unassigned qualified lead.',
  },
  {
    key: 'stalledOnboarding',
    businessName: 'Uttara Uniform Supply (synthetic)',
    contactName: 'Synthetic Ops Buyer',
    contactPhone: '01710000014',
    source: 'manual_entry',
    sourceReference: 'growth-review:stalled-onboarding',
    niche: 'services',
    status: 'onboarding',
    statusChangedAt: daysAgo(20),
    owner: 'sales',
    why: 'Onboarding stalled 15+ days — investigate activation blocker; if unknown mark Needs investigation.',
  },
  {
    key: 'stalledQualified',
    businessName: 'Gazipur Green Grocers (synthetic)',
    contactName: 'Synthetic Grocer',
    contactPhone: '01710000015',
    source: 'event',
    sourceReference: 'growth-review:stalled-qualified',
    niche: 'grocery',
    status: 'qualified',
    statusChangedAt: daysAgo(30),
    owner: 'sales',
    why: 'Qualified 30 days ago without onboarding start.',
  },
  {
    key: 'contactedOwned',
    businessName: 'Dhanmondi Dairy Day (synthetic)',
    contactName: 'Synthetic Dairy Owner',
    contactPhone: '01710000016',
    source: 'browser_extension',
    sourceReference: 'growth-review:contacted-owned',
    niche: 'grocery',
    status: 'contacted',
    owner: 'sales',
    why: 'Open lead with an owner; extension-captured provenance.',
  },
  {
    key: 'activatedHobby',
    businessName: 'Rongdhanu Craft Corner',
    contactName: 'Synthetic Hobby Owner',
    contactPhone: '01710000017',
    contactEmail: 'growth-review-craft@example.test',
    source: 'self_signup',
    sourceReference: 'growth-review:activated',
    niche: 'gifts',
    status: 'converted',
    statusChangedAt: daysAgo(4),
    owner: 'admin',
    linkShopKey: 'hobby',
    why: 'AI activated: first AI reply recorded — NOT a paid conversion.',
  },
  {
    key: 'unreachableDemo',
    businessName: 'Narayanganj Needlework (synthetic)',
    contactName: 'Synthetic Contact',
    contactPhone: '01710000018',
    source: 'referral_mention',
    sourceReference: 'growth-review:unreachable',
    niche: 'tailoring',
    status: 'unreachable',
    owner: 'sales',
    why: 'Operator-marked unreachable; reopen path is contacted.',
  },
  {
    key: 'duplicateAnchor',
    businessName: 'Mirpur Mobile Mart (synthetic)',
    contactName: 'Synthetic Seller',
    contactPhone: '+880 1710-000-199',
    source: 'manual_entry',
    sourceReference: 'growth-review:duplicate-anchor',
    niche: 'electronics',
    status: 'new',
    owner: 'admin',
    why: 'Use +8801710000199 with Add prospect to see server-side duplicate detection.',
  },
  {
    key: 'opsLinkedMerchant',
    businessName: 'Meghna Groceries',
    contactName: 'Synthetic Owner',
    contactPhone: '01710000021',
    contactEmail: 'growth-review-ops@example.test',
    pageUrl: 'https://facebook.example.test/growth-review-ops',
    source: 'partner_form',
    sourceReference: 'growth-review:ops-merchant',
    niche: 'grocery',
    status: 'onboarding',
    statusChangedAt: daysAgo(16),
    owner: 'admin',
    linkShopKey: 'ops',
    why: 'Merchant with suspended subscription and a stuck payment for the Admin drill-down.',
  },
];

const followupDefinitions = [
  {
    key: 'salesOverdue',
    prospectKey: 'fcQualifiedUnassigned',
    owner: 'sales',
    dueAt: daysAgo(2),
    action: 'Call to propose owner assignment and next step',
    note: scenarioLabel('Overdue by ~2 days: first row of the Today queue.'),
  },
  {
    key: 'salesDueToday',
    prospectKey: 'stalledQualified',
    owner: 'sales',
    dueAt: dhakaNoonToday(),
    action: 'Ask why onboarding has not started',
    note: scenarioLabel('Due today in Asia/Dhaka.'),
  },
  {
    key: 'adminFollowUp',
    prospectKey: 'opsLinkedMerchant',
    owner: 'admin',
    dueAt: daysAgo(1),
    action: 'Investigate subscription suspension with merchant',
    note: scenarioLabel('Admin-side overdue item.'),
  },
];

async function resetFixtures() {
  const refs = prospectDefinitions.map((definition) => definition.sourceReference);
  const existing = await GrowthOsProspect.findAll({
    where: { source_reference: { [Op.in]: refs } },
    attributes: ['id'],
  });
  const ids = existing.map((record) => record.id);
  if (ids.length === 0) return;
  await GrowthOsFollowup.destroy({ where: { prospect_id: { [Op.in]: ids } } });
  await GrowthOsNote.destroy({ where: { target_type: 'prospect', target_id: { [Op.in]: ids } } });
  await GrowthOsProspectEvent.destroy({ where: { prospect_id: { [Op.in]: ids } } });
  await AuditLog.destroy({ where: { resource_type: 'growth_os_prospect', resource_id: { [Op.in]: ids } } });
  await GrowthOsProspect.destroy({ where: { id: { [Op.in]: ids } } });

  await GrowthOsNote.destroy({ where: { target_type: 'shop' } });
  await AuditLog.destroy({ where: { resource_type: 'GROWTH_OS_ADMIN_MERCHANT', action: 'growth_review_demo:seed_receipt' } });
}

async function ensureTenant() {
  const [tenant] = await Tenant.findOrCreate({
    where: { name: tenantName },
    defaults: { name: tenantName, is_active: true, settings: { fixture: FIXTURE_VERSION } },
  });
  const shops = {};
  for (const [key, definition] of Object.entries(shopDefinitions)) {
    const [shop] = await Shop.findOrCreate({
      where: { unique_code: definition.unique_code },
      defaults: {
        unique_code: definition.unique_code,
        tenant_id: tenant.id,
        shop_name: definition.name,
        name: definition.name,
        is_active: definition.is_active,
        timezone: 'Asia/Dhaka',
        settings: definition.settings,
      },
    });
    await shop.update({
      tenant_id: tenant.id,
      shop_name: definition.name,
      name: definition.name,
      is_active: definition.is_active,
      settings: definition.settings,
    });
    shops[key] = shop;

    await Subscription.destroy({ where: { shop_id: shop.id } });
    if (definition.subscription) {
      await Subscription.create({
        shop_id: shop.id,
        plan_name: definition.subscription.planName,
        plan_price: definition.subscription.planPrice,
        billing_cycle: 'monthly',
        status: definition.subscription.status,
      });
    }

    await PaymentTransaction.destroy({ where: { shop_id: shop.id } });
    if (definition.payment) {
      const [order] = await Order.findOrCreate({
        where: { shop_id: shop.id, order_number: `${definition.unique_code}-BILL-1` },
        defaults: {
          shop_id: shop.id,
          order_number: `${definition.unique_code}-BILL-1`,
          customer_name: 'Synthetic Plan Order',
          subtotal: definition.payment.amount,
          order_status: 'awaiting_payment',
          payment_status: 'pending',
        },
      });
      await PaymentTransaction.create({
        order_id: order.id,
        shop_id: shop.id,
        payment_method: 'bkash',
        payment_gateway: 'bkash',
        transaction_id: `growth-review-stuck-${order.id}`,
        amount: definition.payment.amount,
        status: definition.payment.status,
        created_at: daysAgo(definition.payment.createdAtDaysAgo),
        updated_at: daysAgo(definition.payment.createdAtDaysAgo),
      });
    }

    await MetaChannel.destroy({ where: { shop_id: shop.id } });
    if (definition.channel) {
      await MetaChannel.create({
        shop_id: shop.id,
        platform: 'facebook',
        meta_asset_id: definition.channel.pageId,
        display_name: definition.channel.displayName,
        status: definition.channel.status,
        last_error: 'TOKEN_EXPIRED',
        connected_at: daysAgo(60),
      });
    } else {
      await MetaChannel.create({
        shop_id: shop.id,
        platform: 'facebook',
        meta_asset_id: `12025000000000${Object.keys(shopDefinitions).indexOf(key) + 2}`,
        display_name: `${definition.name} (test page)`,
        status: 'CONNECTED',
        connected_at: daysAgo(30),
      });
    }
  }
  return { tenant, shops };
}

async function ensureUser(key, definition, passwordHash, merchantShop) {
  const [user] = await User.findOrCreate({
    where: { email: definition.email },
    defaults: {
      email: definition.email,
      password: passwordHash,
      full_name: definition.full_name,
      phone: definition.phone,
      token_version: 0,
      settings: {},
      last_logged_shop_id: definition.role ? null : merchantShop?.id || null,
    },
  });
  await user.update({
    password: passwordHash,
    full_name: definition.full_name,
    phone: definition.phone,
    token_version: 0,
    refresh_token: null,
    settings: {},
    last_logged_shop_id: definition.role ? null : merchantShop?.id || null,
  });
  if (definition.role) {
    await UserShop.update({ is_active: false }, { where: { user_id: user.id, is_active: true } });
  } else if (merchantShop) {
    const [membership] = await UserShop.findOrCreate({
      where: { user_id: user.id, shop_id: merchantShop.id },
      defaults: { user_id: user.id, shop_id: merchantShop.id, role: definition.shopRole, is_active: true },
    });
    await membership.update({ role: definition.shopRole, is_active: true });
  }
  await GrowthOsUserRole.destroy({ where: { user_id: user.id } });
  if (definition.role) {
    await GrowthOsUserRole.create({
      user_id: user.id,
      role: definition.role,
      is_active: true,
      granted_by: user.id,
      metadata: { source: FIXTURE_VERSION },
    });
  }
  let totpSecret = null;
  if (definition.totp) {
    const generated = await generateTotpSecret(user.id);
    await enableTotp(user.id, hotp(generated.secret, Math.floor(Date.now() / 1000 / 30)));
    totpSecret = generated.secret;
  }
  return { user, totpSecret };
}

async function seedProspects(users, shops) {
  const prospects = {};
  for (const definition of prospectDefinitions) {
    const identity = normalizeIdentity({
      business_name: definition.businessName,
      contact_phone: definition.contactPhone,
      contact_email: definition.contactEmail || null,
      page_url: definition.pageUrl || null,
    });
    const ownerUserId = definition.owner ? users[definition.owner].user.id : null;
    const changedAt = definition.statusChangedAt || now();
    const linkedShop = definition.linkShopKey ? shops[definition.linkShopKey] : null;
    const prospect = await GrowthOsProspect.create({
      business_name: definition.businessName,
      contact_name: definition.contactName,
      contact_phone: definition.contactPhone,
      contact_email: definition.contactEmail || null,
      page_url: definition.pageUrl || null,
      niche: definition.niche,
      notes: scenarioLabel(definition.why),
      ...identity,
      source: definition.source,
      source_detail: FIXTURE_VERSION,
      source_reference: definition.sourceReference,
      source_recorded_at: changedAt,
      status: definition.status,
      status_changed_at: changedAt,
      owner_user_id: ownerUserId,
      assigned_at: ownerUserId ? changedAt : null,
      assigned_by: ownerUserId ? users.admin.user.id : null,
      linked_shop_id: linkedShop ? linkedShop.id : null,
      linked_at: linkedShop ? changedAt : null,
      created_by: users.admin.user.id,
      metadata: { fixture: FIXTURE_VERSION, scenario: definition.key },
    });
    await GrowthOsProspectEvent.create({
      prospect_id: prospect.id,
      event_type: 'created',
      actor_user_id: users.admin.user.id,
      reason: scenarioLabel(definition.why),
      changed_fields: ['business_name', 'source', 'status'],
      metadata: { fixture: FIXTURE_VERSION },
    });
    await AuditLog.create({
      user_id: users.admin.user.id,
      shop_id: null,
      action: 'growth_os:prospect_created',
      resource_type: 'growth_os_prospect',
      resource_id: prospect.id,
      old_values: null,
      new_values: prospect.toJSON(),
      metadata: { source: FIXTURE_VERSION },
      ip_address: '127.0.0.1',
      user_agent: 'growth-review-seed',
    });
    prospects[definition.key] = prospect;
  }
  return prospects;
}

async function seedWork(users, prospects) {
  const followups = {};
  for (const definition of followupDefinitions) {
    followups[definition.key] = await GrowthOsFollowup.create({
      prospect_id: prospects[definition.prospectKey].id,
      owner_user_id: users[definition.owner].user.id,
      created_by: users[definition.owner].user.id,
      due_at: definition.dueAt,
      action: definition.action,
      note: definition.note,
      status: 'open',
    });
    await GrowthOsProspectEvent.create({
      prospect_id: prospects[definition.prospectKey].id,
      event_type: 'followup_created',
      actor_user_id: users[definition.owner].user.id,
      reason: scenarioLabel('Scheduled during local review seeding.'),
      metadata: { followup_id: followups[definition.key].id },
    });
  }
  const note = await GrowthOsNote.create({
    target_type: 'prospect',
    target_id: prospects.stalledOnboarding.id,
    author_user_id: users.sales.user.id,
    body: scenarioLabel('Owner unreachable twice on recorded phone; needs investigation, no cause implied.'),
  });
  await GrowthOsNote.create({
    target_type: 'shop',
    target_id: (await Shop.findOne({ where: { unique_code: shopDefinitions.ops.unique_code } })).id,
    author_user_id: users.admin.user.id,
    body: scenarioLabel('Dunning paused recurring invoice; suspended subscription signal is canonical.'),
  });
  await AuditLog.create({
    user_id: users.admin.user.id,
    shop_id: (await Shop.findOne({ where: { unique_code: shopDefinitions.hobby.unique_code } })).id,
    action: 'growth_review_demo:seed_receipt',
    resource_type: 'GROWTH_OS_ADMIN_MERCHANT',
    resource_id: null,
    old_values: null,
    new_values: { seeded: true },
    metadata: { source: FIXTURE_VERSION },
    ip_address: '127.0.0.1',
    user_agent: 'growth-review-seed',
  });
  return { followups, note };
}

async function main() {
  const { tenant, shops } = await ensureTenant();
  const passwordHash = await hashPassword(password);
  const users = {};
  for (const [key, definition] of Object.entries(userDefinitions)) {
    users[key] = await ensureUser(key, definition, passwordHash, shops.ops);
  }

  await resetFixtures();
  const prospects = await seedProspects(users, shops);
  const work = await seedWork(users, prospects);

  const receipt = {
    fixtureVersion: FIXTURE_VERSION,
    environment: 'local-review',
    tenant: { id: tenant.id, name: tenant.name },
    shops: Object.fromEntries(Object.entries(shops).map(([key, shop]) => [key, {
      id: shop.id,
      name: shop.name,
      uniqueCode: shop.unique_code,
    }])),
    accounts: Object.fromEntries(Object.entries(users).map(([key, entry]) => [key, {
      email: userDefinitions[key].email,
      role: userDefinitions[key].role,
      password,
      ...(entry.totpSecret ? { totpSecret: entry.totpSecret } : {}),
    }])),
    prospects: Object.fromEntries(Object.entries(prospects).map(([key, prospect]) => [key, {
      id: prospect.id,
      businessName: prospect.business_name,
      status: prospect.status,
      source: prospect.source,
    }])),
    followups: Object.fromEntries(Object.entries(work.followups).map(([key, followup]) => [key, {
      id: followup.id,
      dueAt: followup.due_at,
    }])),
  };
  console.log(JSON.stringify({ receipt }));
  console.error(`Growth local review seed complete: ${Object.keys(users).length} identities, ${Object.keys(prospects).length} prospects, ${Object.keys(work.followups).length} follow-ups across ${Object.keys(shops).length} synthetic shops.`);
}

main()
  .catch((error) => {
    console.error(`Growth local review seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
