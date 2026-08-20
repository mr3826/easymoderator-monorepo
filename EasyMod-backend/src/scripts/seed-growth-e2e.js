'use strict';

const args = new Set(process.argv.slice(2));
const { assertDisposableDatabase } = require('../../tests/helpers/disposable-database');
assertDisposableDatabase(process.env.DATABASE_URL, 'the Growth OS browser E2E seed');

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../utils/database/database-setup');
const {
  AuditLog,
  GrowthOsProspect,
  GrowthOsProspectEvent,
  GrowthOsUserRole,
  Shop,
  Tenant,
  User,
  UserShop,
} = require('../modules/entities');
const { hashPassword } = require('../utils/password.util');
const { generateTotpSecret, enableTotp, hotp } = require('../modules/auth/totp.service');
const { normalizeIdentity } = require('../modules/growth-os/growth-os.prospect.identity');

const repoRoot = path.resolve(__dirname, '../../..');
const fixturePath = path.join(repoRoot, 'EasyMod-growth', 'tests', 'e2e', '.fixtures.json');
const password = 'GrowthE2E-Password-2026!';
const privateMarker = 'growth-e2e-private-marker';
const privateTimelineReason = 'growth-e2e-private-timeline-reason';
const tenantName = 'Growth OS browser E2E tenant';
const shopCode = 'GROWTH-E2E-01';

const userDefinitions = {
  founder: {
    email: 'growth-e2e-founder@example.test',
    full_name: 'Growth E2E Founder',
    phone: '01700000101',
    role: 'FOUNDER',
    shopRole: 'owner',
  },
  executive: {
    email: 'growth-e2e-executive@example.test',
    full_name: 'Growth E2E Executive',
    phone: '01700000102',
    role: 'BUSINESS_EXECUTIVE',
    shopRole: 'admin',
  },
  marketer: {
    email: 'growth-e2e-marketer@example.test',
    full_name: 'Growth E2E Marketer',
    phone: '01700000103',
    role: 'MARKETER',
    shopRole: 'admin',
  },
  staleSession: {
    email: 'growth-e2e-stale@example.test',
    full_name: 'Growth E2E Stale Session',
    phone: '01700000104',
    role: 'BUSINESS_EXECUTIVE',
    shopRole: 'staff',
  },
  merchant: {
    email: 'growth-e2e-merchant@example.test',
    full_name: 'Growth E2E Merchant',
    phone: '01700000105',
    role: null,
    shopRole: 'staff',
  },
};

const prospectDefinitions = [
  {
    key: 'northStar',
    source: 'manual_entry',
    sourceReference: 'growth-e2e:north-star',
    businessName: 'North Star Retail',
    contactName: 'Growth E2E Merchant',
    contactPhone: userDefinitions.merchant.phone,
    contactEmail: userDefinitions.merchant.email,
    pageUrl: 'https://facebook.com/growth-e2e-north-star',
    niche: 'retail',
    notes: 'North Star private notes',
    metadata: { privateMarker, fixture: true },
    status: 'new',
    owner: 'founder',
  },
  {
    key: 'executiveAssigned',
    source: 'self_signup',
    sourceReference: 'growth-e2e:executive-assigned',
    businessName: 'Executive Assigned Studio',
    contactName: 'Executive Contact',
    contactPhone: '01700000201',
    contactEmail: 'growth-e2e-executive-assigned@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-executive-assigned',
    niche: 'services',
    notes: 'Assigned executive notes',
    metadata: { fixture: true },
    status: 'qualified',
    owner: 'executive',
  },
  {
    key: 'marketingRedacted',
    source: 'partner_form',
    sourceReference: 'growth-e2e:marketing-redacted',
    businessName: 'Cedar Campaign Bakery',
    contactName: 'Marketing Contact',
    contactPhone: '01700000202',
    contactEmail: 'growth-e2e-marketing@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-cedar',
    niche: 'food',
    notes: privateMarker,
    metadata: { privateMarker, campaign: 'cedar' },
    status: 'contacted',
    owner: 'marketer',
    timelineReason: privateTimelineReason,
  },
  {
    key: 'manualPrivate',
    source: 'manual_entry',
    sourceReference: 'growth-e2e:manual-private',
    businessName: 'Manual Ledger Services',
    contactName: 'Manual Contact',
    contactPhone: '01700000203',
    contactEmail: 'growth-e2e-manual@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-manual',
    niche: 'services',
    notes: 'Manual-only notes',
    metadata: { fixture: true },
    status: 'disqualified',
    disqualifiedReason: 'No response during qualification',
    owner: 'founder',
  },
  {
    key: 'eventUnreachable',
    source: 'event',
    sourceReference: 'growth-e2e:event-unreachable',
    businessName: 'Event Unreachable Shop',
    contactName: 'Event Contact',
    contactPhone: '01700000204',
    contactEmail: 'growth-e2e-event@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-event',
    niche: 'retail',
    notes: 'Event follow-up notes',
    metadata: { fixture: true },
    status: 'unreachable',
    owner: 'executive',
  },
  {
    key: 'converted',
    source: 'other',
    sourceReference: 'growth-e2e:converted',
    businessName: 'Converted E2E Shop',
    contactName: 'Converted Contact',
    contactPhone: '01700000205',
    contactEmail: 'growth-e2e-converted@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-converted',
    niche: 'retail',
    notes: 'Converted fixture notes',
    metadata: { fixture: true },
    status: 'converted',
    owner: 'founder',
    linkedShop: true,
  },
  {
    key: 'mergeSource',
    source: 'other',
    sourceReference: 'growth-e2e:merge-source',
    businessName: 'Merge Source Prospect',
    contactName: 'Merge Source Contact',
    contactPhone: '01700000206',
    contactEmail: 'growth-e2e-merge-source@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-merge-source',
    niche: 'retail',
    notes: 'Source record to tombstone',
    metadata: { fixture: true },
    status: 'contacted',
    owner: 'founder',
  },
  {
    key: 'mergeTarget',
    source: 'other',
    sourceReference: 'growth-e2e:merge-target',
    businessName: 'Merge Target Prospect',
    contactName: 'Merge Target Contact',
    contactPhone: '01700000207',
    contactEmail: 'growth-e2e-merge-target@example.test',
    pageUrl: 'https://facebook.com/growth-e2e-merge-target',
    niche: 'retail',
    notes: 'Target record remains active',
    metadata: { fixture: true },
    status: 'new',
    owner: 'founder',
  },
];

async function ensureTenant() {
  const [tenant] = await Tenant.findOrCreate({
    where: { name: tenantName },
    defaults: { name: tenantName, is_active: true, settings: { fixture: 'growth-e2e' } },
  });
  await tenant.update({ is_active: true, settings: { fixture: 'growth-e2e' } });

  const [shop] = await Shop.findOrCreate({
    where: { unique_code: shopCode },
    defaults: {
      unique_code: shopCode,
      tenant_id: tenant.id,
      shop_name: 'Growth OS browser E2E shop',
      name: 'Growth OS browser E2E shop',
      is_active: true,
      timezone: 'Asia/Dhaka',
      settings: { fixture: 'growth-e2e' },
    },
  });
  await shop.update({
    tenant_id: tenant.id,
    shop_name: 'Growth OS browser E2E shop',
    name: 'Growth OS browser E2E shop',
    is_active: true,
    settings: { fixture: 'growth-e2e' },
  });
  return { tenant, shop };
}

async function ensureUser(definition, passwordHash, shop) {
  const [user] = await User.findOrCreate({
    where: { email: definition.email },
    defaults: {
      email: definition.email,
      password: passwordHash,
      full_name: definition.full_name,
      phone: definition.phone,
      token_version: 0,
      settings: {},
      last_logged_shop_id: shop.id,
    },
  });
  await user.update({
    password: passwordHash,
    full_name: definition.full_name,
    phone: definition.phone,
    token_version: 0,
    refresh_token: null,
    settings: {},
    last_logged_shop_id: shop.id,
  });

  const [membership] = await UserShop.findOrCreate({
    where: { user_id: user.id, shop_id: shop.id },
    defaults: { user_id: user.id, shop_id: shop.id, role: definition.shopRole, is_active: true },
  });
  await membership.update({ role: definition.shopRole, is_active: true });
  return user;
}

async function setGrowthRole(user, role, founderId) {
  await GrowthOsUserRole.destroy({ where: { user_id: user.id } });
  if (!role) return;
  await GrowthOsUserRole.create({
    user_id: user.id,
    role,
    is_active: true,
    granted_by: founderId,
    metadata: { source: 'growth-e2e-fixture' },
  });
}

async function resetProspectFixtures() {
  const where = {
    [Op.or]: prospectDefinitions.map(({ source, sourceReference }) => ({
      source,
      source_reference: sourceReference,
    })),
  };
  const existing = await GrowthOsProspect.findAll({ where, attributes: ['id'] });
  const ids = existing.map((record) => record.id);
  if (ids.length === 0) return;

  await GrowthOsProspectEvent.destroy({ where: { prospect_id: { [Op.in]: ids } } });
  await AuditLog.destroy({
    where: {
      resource_type: 'growth_os_prospect',
      resource_id: { [Op.in]: ids },
    },
  });
  await GrowthOsProspect.destroy({ where: { id: { [Op.in]: ids } } });
}

async function createProspectFixture(definition, users, shop) {
  const identity = normalizeIdentity({
    business_name: definition.businessName,
    contact_phone: definition.contactPhone,
    contact_email: definition.contactEmail,
    page_url: definition.pageUrl,
  });
  const ownerUserId = definition.owner ? users[definition.owner].id : null;
  const now = new Date();
  const prospect = await GrowthOsProspect.create({
    business_name: definition.businessName,
    contact_name: definition.contactName,
    contact_phone: definition.contactPhone,
    contact_email: definition.contactEmail,
    page_url: definition.pageUrl,
    niche: definition.niche,
    notes: definition.notes,
    ...identity,
    source: definition.source,
    source_detail: 'growth-e2e-fixture',
    source_reference: definition.sourceReference,
    source_recorded_at: now,
    status: definition.status,
    status_changed_at: now,
    disqualified_reason: definition.disqualifiedReason || null,
    owner_user_id: ownerUserId,
    assigned_at: ownerUserId ? now : null,
    assigned_by: ownerUserId ? users.founder.id : null,
    linked_shop_id: definition.linkedShop ? shop.id : null,
    linked_user_id: null,
    linked_at: definition.linkedShop ? now : null,
    created_by: users.founder.id,
    metadata: definition.metadata,
  });

  await GrowthOsProspectEvent.create({
    prospect_id: prospect.id,
    event_type: 'created',
    actor_user_id: users.founder.id,
    reason: definition.timelineReason || 'growth-e2e fixture bootstrap',
    changed_fields: ['business_name', 'source', 'status'],
    metadata: definition.timelineReason ? { privateMarker } : { fixture: true },
  });
  await AuditLog.create({
    user_id: users.founder.id,
    shop_id: null,
    action: 'growth_os:prospect_created',
    resource_type: 'growth_os_prospect',
    resource_id: prospect.id,
    old_values: null,
    new_values: prospect.toJSON(),
    metadata: { source: 'growth-e2e-fixture' },
    ip_address: '127.0.0.1',
    user_agent: 'growth-e2e-seed',
  });
  return prospect;
}

async function main() {
  const { tenant, shop } = await ensureTenant();
  const passwordHash = await hashPassword(password);
  const users = {};

  for (const [key, definition] of Object.entries(userDefinitions)) {
    users[key] = await ensureUser(definition, passwordHash, shop);
  }
  for (const [key, definition] of Object.entries(userDefinitions)) {
    await setGrowthRole(users[key], definition.role, users.founder.id);
  }

  const { secret: founderTotpSecret } = await generateTotpSecret(users.founder.id);
  await enableTotp(
    users.founder.id,
    hotp(founderTotpSecret, Math.floor(Date.now() / 1000 / 30)),
  );

  await resetProspectFixtures();
  const prospects = {};
  for (const definition of prospectDefinitions) {
    prospects[definition.key] = await createProspectFixture(definition, users, shop);
  }

  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify({
    version: 1,
    password,
    privateMarker,
    privateTimelineReason,
    tenant: { id: tenant.id, name: tenant.name },
    shop: { id: shop.id, name: shop.name, shopName: shop.shop_name },
    users: Object.fromEntries(Object.entries(users).map(([key, user]) => [key, {
      id: user.id,
      email: user.email,
      password,
      role: userDefinitions[key].role,
      ...(key === 'founder' ? { totpSecret: founderTotpSecret } : {}),
    }])),
    prospects: Object.fromEntries(Object.entries(prospects).map(([key, prospect]) => [key, {
      id: prospect.id,
      businessName: prospect.business_name,
      source: prospect.source,
      status: prospect.status,
    }])),
  }, null, 2)}\n`, 'utf8');

  console.log(`Growth browser E2E fixtures written to ${path.relative(repoRoot, fixturePath)}`);
  console.log(`Seeded ${Object.keys(users).length} users and ${Object.keys(prospects).length} prospects.`);
  if (args.has('--print')) console.log(JSON.stringify({ fixturePath, users, prospects }, null, 2));
}

main()
  .catch((error) => {
    console.error(`Growth browser E2E seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
