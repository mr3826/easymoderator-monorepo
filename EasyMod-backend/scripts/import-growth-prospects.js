'use strict';

const prospectService = require('../src/modules/growth-os/growth-os.prospect.service');

const VALID_IMPORTED_STATUSES = new Set([
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'disqualified',
  'unreachable',
]);

function models() {
  const {
    AuditLog,
    PartnerApplication,
    User,
    Shop,
    UserShop,
  } = require('../src/modules/entities');
  return { AuditLog, PartnerApplication, User, Shop, UserShop };
}

function sourceValue(value) {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'signup' || source === 'self_signup') return 'self_signup';
  if (source === 'partner_form' || source === 'partner_application') return 'partner_form';
  if (source === 'manual' || source === 'manual_entry') return 'manual_entry';
  if (source === 'referral' || source === 'referral_mention') return 'referral_mention';
  if (source === 'inbound' || source === 'inbound_message') return 'inbound_message';
  if (source === 'event') return 'event';
  return 'other';
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function activeShop(shop) {
  return shop || null;
}

function importedStatus(metadata, linkedShop, reason) {
  const status = String(metadata.status || '').trim().toLowerCase();
  if ((status === 'disqualified' || status === 'rejected') && reason) return 'disqualified';
  if (linkedShop) return 'converted';
  return VALID_IMPORTED_STATUSES.has(status) ? status : 'new';
}

function crmImportRow(row, user, shop) {
  const metadata = objectValue(row.metadata);
  const linkedShop = activeShop(shop);
  const sourceDetail = metadata.lead_source || metadata.source || null;
  const disqualifiedReason = metadata.disqualified_reason || metadata.objection || null;
  return {
    source: sourceValue(sourceDetail),
    sourceReference: row.idempotency_key || `crm_lead:${row.id}`,
    data: {
      businessName: metadata.business_name
        || metadata.businessName
        || metadata.shop_name
        || linkedShop?.name
        || linkedShop?.shop_name
        || user?.full_name
        || user?.email
        || `Imported prospect ${row.resource_id || row.id}`,
      contactName: user?.full_name || metadata.contact_name || null,
      contactPhone: user?.phone || metadata.phone || null,
      contactEmail: user?.email || metadata.email || null,
      pageUrl: metadata.facebook_page || metadata.page_url || null,
      niche: metadata.niche || null,
      notes: metadata.notes || metadata.next_action || null,
      sourceDetail: sourceDetail ? String(sourceDetail).slice(0, 160) : null,
      linkedShopId: linkedShop?.id || null,
      linkedUserId: user?.id || null,
      status: importedStatus(metadata, linkedShop, disqualifiedReason),
      disqualified_reason: disqualifiedReason,
      source_recorded_at: row.created_at || null,
      metadata: {
        imported_from: 'audit_logs',
        source_audit_id: row.id,
        legacy_status: metadata.status || null,
        activation_stage: metadata.activation_stage || null,
      },
    },
  };
}

function partnerImportRow(row, user, shop) {
  const linkedShop = activeShop(shop);
  const disqualifiedReason = row.status === 'rejected'
    ? (row.notes || 'Partner application rejected')
    : null;
  return {
    source: 'partner_form',
    sourceReference: `partner_application:${row.id}`,
    data: {
      businessName: row.business_name,
      contactName: user?.full_name || null,
      contactPhone: row.phone,
      contactEmail: user?.email || null,
      pageUrl: row.page_link,
      notes: row.notes || null,
      sourceDetail: 'partner_form',
      linkedShopId: linkedShop?.id || null,
      linkedUserId: user?.id || null,
      status: importedStatus({ status: row.status }, linkedShop, disqualifiedReason),
      disqualified_reason: disqualifiedReason,
      source_recorded_at: row.created_at || null,
      metadata: {
        imported_from: 'partner_applications',
        partner_application_id: row.id,
        application_status: row.status,
      },
    },
  };
}

async function loadRows() {
  const { AuditLog, PartnerApplication, User, Shop, UserShop } = models();
  const [crmRows, partnerRows] = await Promise.all([
    AuditLog.findAll({
      where: { resource_type: 'crm_lead' },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    }),
    PartnerApplication.findAll({
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    }),
  ]);

  const shopIds = [...crmRows, ...partnerRows].map((row) => row.shop_id).filter(Boolean);
  const userIds = crmRows.map((row) => row.user_id).filter(Boolean);
  const [users, shops, memberships] = await Promise.all([
    userIds.length
      ? User.findAll({
        where: { id: [...new Set(userIds)] },
        attributes: ['id', 'email', 'full_name', 'phone'],
      })
      : [],
    shopIds.length
      ? Shop.findAll({
        where: { id: [...new Set(shopIds)] },
        attributes: ['id', 'name', 'shop_name', 'is_active'],
      })
      : [],
    UserShop && shopIds.length
      ? UserShop.findAll({
        where: { shop_id: [...new Set(shopIds)], role: 'owner', is_active: true },
        attributes: ['user_id', 'shop_id'],
      })
      : [],
  ]);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const shopsById = new Map(shops.map((shop) => [shop.id, shop]));
  const ownerIdsByShop = new Map(memberships.map((membership) => [membership.shop_id, membership.user_id]));
  const ownerIds = [...new Set(memberships.map((membership) => membership.user_id).filter(Boolean))];
  const owners = ownerIds.length
    ? await User.findAll({
      where: { id: ownerIds },
      attributes: ['id', 'email', 'full_name', 'phone'],
    })
    : [];
  for (const owner of owners) usersById.set(owner.id, owner);

  return [
    ...crmRows.map((row) => {
      const shop = shopsById.get(row.shop_id);
      const user = usersById.get(row.user_id)
        || usersById.get(ownerIdsByShop.get(row.shop_id));
      return crmImportRow(row, user, shop);
    }),
    ...partnerRows.map((row) => {
      const shop = shopsById.get(row.shop_id);
      const owner = usersById.get(ownerIdsByShop.get(row.shop_id));
      return partnerImportRow(row, owner, shop);
    }),
  ];
}

async function run({ apply = false } = {}) {
  const rows = await loadRows();
  const counts = { created: 0, skippedDuplicate: 0, failed: 0 };
  const results = [];

  for (const row of rows) {
    try {
      const result = await prospectService.createImported({
        data: row.data,
        source: row.source,
        sourceReference: row.sourceReference,
        dryRun: !apply,
      });
      if (result.created) counts.created += 1;
      if (result.skippedDuplicate) counts.skippedDuplicate += 1;
      results.push({
        source: row.source,
        sourceReference: row.sourceReference,
        outcome: result.created ? 'created' : result.skippedDuplicate ? 'skipped-duplicate' : 'would-create',
        conflictingProspectId: result.conflictingProspectId || null,
      });
    } catch (error) {
      counts.failed += 1;
      results.push({
        source: row.source,
        sourceReference: row.sourceReference,
        outcome: 'failed',
        error: error.code || 'INTERNAL_ERROR',
      });
    }
  }

  return {
    dryRun: !apply,
    total: rows.length,
    counts,
    results,
  };
}

function parseArgs(args) {
  return { apply: args.includes('--apply') };
}

module.exports = {
  run,
  loadRows,
  parseArgs,
  crmImportRow,
  partnerImportRow,
};

if (require.main === module) {
  run(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { sequelize } = require('../src/utils/database/database-setup');
      await sequelize.close();
    });
}
