'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const prospectService = require('../src/modules/growth-os/growth-os.prospect.service');

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;
const VALID_IMPORTED_STATUSES = new Set([
  'new', 'contacted', 'qualifying', 'qualified', 'disqualified', 'unreachable',
]);

function models() {
  const { AuditLog, PartnerApplication, User, Shop, UserShop } = require('../src/modules/entities');
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
  return shop?.is_active === true ? shop : null;
}

function importedStatus(metadata, linkedShop, reason) {
  const status = String(metadata.status || '').trim().toLowerCase();
  if ((status === 'disqualified' || status === 'rejected') && reason) return 'disqualified';
  if (linkedShop) return 'converted';
  return VALID_IMPORTED_STATUSES.has(status) ? status : 'new';
}

// Historical activation evidence: the linked shop's recorded first successful
// AI reply. Import converts with this evidence get a canonical `activated`
// event at that instant; without evidence the row is excluded from activation
// timing rather than given a synthesized event.
function activationEvidenceAt(linkedShop, status) {
  if (status !== 'converted') return null;
  const occurredAt = objectValue(linkedShop?.settings).first_ai_reply?.occurred_at;
  return occurredAt || null;
}

function crmImportRow(row, user, shop) {
  const metadata = objectValue(row.metadata);
  const linkedShop = activeShop(shop);
  const sourceDetail = metadata.lead_source || metadata.source || null;
  const disqualifiedReason = metadata.disqualified_reason || metadata.objection || null;
  const status = importedStatus(metadata, linkedShop, disqualifiedReason);
  return {
    source: sourceValue(sourceDetail),
    sourceReference: row.idempotency_key || `crm_lead:${row.id}`,
    activationEvidenceAt: activationEvidenceAt(linkedShop, status),
    data: {
      businessName: metadata.business_name || metadata.businessName || metadata.shop_name
        || linkedShop?.name || linkedShop?.shop_name || user?.full_name || user?.email
        || `Imported prospect ${row.resource_id || row.id}`,
      contactName: user?.full_name || metadata.contact_name || null,
      contactPhone: user?.phone || metadata.phone || null,
      contactEmail: user?.email || metadata.email || null,
      pageUrl: metadata.facebook_page || metadata.page_url || null,
      niche: metadata.niche || null,
      notes: metadata.notes || metadata.next_action || null,
      sourceDetail: sourceDetail ? String(sourceDetail).slice(0, 160) : null,
      linkedShopId: linkedShop?.id || null,
      linkedUserId: linkedShop ? (user?.id || null) : null,
      status,
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
    ? (row.notes || 'Partner application rejected') : null;
  const status = importedStatus({ status: row.status }, linkedShop, disqualifiedReason);
  return {
    source: 'partner_form',
    sourceReference: `partner_application:${row.id}`,
    activationEvidenceAt: activationEvidenceAt(linkedShop, status),
    data: {
      businessName: row.business_name,
      contactName: user?.full_name || null,
      contactPhone: row.phone,
      contactEmail: user?.email || null,
      pageUrl: row.page_link,
      notes: row.notes || null,
      sourceDetail: 'partner_form',
      linkedShopId: linkedShop?.id || null,
      linkedUserId: linkedShop ? (user?.id || null) : null,
      status,
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

function cursorWhere(cursor) {
  if (!cursor) return {};
  return { [Op.or]: [
    { created_at: { [Op.gt]: cursor.createdAt } },
    { created_at: cursor.createdAt, id: { [Op.gt]: cursor.id } },
  ] };
}

function cursorFor(rows) {
  const row = rows[rows.length - 1];
  return row ? { createdAt: row.created_at, id: row.id } : null;
}

async function relatedRows(rows) {
  const { User, Shop, UserShop } = models();
  const shopIds = [...new Set(rows.map((row) => row.shop_id).filter(Boolean))];
  const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const [users, shops, memberships] = await Promise.all([
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ['id', 'email', 'full_name', 'phone'] }) : [],
    shopIds.length ? Shop.findAll({ where: { id: shopIds }, attributes: ['id', 'name', 'shop_name', 'is_active', 'settings'] }) : [],
    UserShop && shopIds.length
      ? UserShop.findAll({
        where: { shop_id: shopIds, role: 'owner', is_active: true },
        attributes: ['user_id', 'shop_id'],
        order: [['shop_id', 'ASC'], ['user_id', 'ASC']],
      }) : [],
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const shopsById = new Map(shops.map((shop) => [shop.id, shop]));
  const ownerIdsByShop = new Map();
  for (const membership of memberships) {
    if (!ownerIdsByShop.has(membership.shop_id)) ownerIdsByShop.set(membership.shop_id, membership.user_id);
  }
  const ownerIds = [...new Set(memberships.map((membership) => membership.user_id).filter(Boolean))];
  if (ownerIds.length) {
    const owners = await User.findAll({ where: { id: ownerIds }, attributes: ['id', 'email', 'full_name', 'phone'] });
    for (const owner of owners) usersById.set(owner.id, owner);
  }
  return { usersById, shopsById, ownerIdsByShop };
}

async function* sourceRows(Model, attributes, source, batchSize) {
  let cursor = null;
  do {
    const rows = await Model.findAll({
      where: source === 'crm' ? { ...cursorWhere(cursor), resource_type: 'crm_lead' } : cursorWhere(cursor),
      attributes,
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      limit: batchSize,
    });
    if (!rows.length) return;
    yield rows;
    cursor = cursorFor(rows);
  } while (cursor);
}

async function* loadRows({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const { AuditLog, PartnerApplication } = models();
  const sources = [
    [sourceRows(AuditLog, ['id', 'user_id', 'shop_id', 'resource_id', 'idempotency_key', 'metadata', 'created_at'], 'crm', batchSize), 'crm'],
    [sourceRows(PartnerApplication, ['id', 'shop_id', 'business_name', 'phone', 'page_link', 'status', 'notes', 'created_at'], 'partner', batchSize), 'partner'],
  ];
  for (const [source, kind] of sources) {
    for await (const rows of source) {
      const { usersById, shopsById, ownerIdsByShop } = await relatedRows(rows);
      for (const row of rows) {
        const shop = shopsById.get(row.shop_id);
        const user = usersById.get(row.user_id) || usersById.get(ownerIdsByShop.get(row.shop_id));
        yield kind === 'crm' ? crmImportRow(row, user, shop) : partnerImportRow(row, user, shop);
      }
    }
  }
}

function normalizeBatchSize(value) {
  const batchSize = Number(value);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return batchSize;
}

function parseArgs(args) {
  const options = { apply: false, batchSize: DEFAULT_BATCH_SIZE, runId: null, receipt: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--batch-size') options.batchSize = args[++index];
    else if (arg.startsWith('--batch-size=')) options.batchSize = arg.slice(13);
    else if (arg === '--run-id') options.runId = args[++index];
    else if (arg.startsWith('--run-id=')) options.runId = arg.slice(9);
    else if (arg === '--receipt' || arg === '--out') options.receipt = args[++index];
    else if (arg.startsWith('--receipt=') || arg.startsWith('--out=')) options.receipt = arg.slice(arg.indexOf('=') + 1);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.batchSize = normalizeBatchSize(options.batchSize);
  options.runId = options.runId || `growth-prospect-import-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  options.receipt = options.receipt || path.resolve(process.cwd(), 'growth-os-receipts', `${options.runId}.json`);
  return options;
}

function receiptWriter(filePath, header) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  stream.write(`${JSON.stringify(header).slice(0, -1)},"rows":[`);
  let first = true;
  return {
    append(row) {
      stream.write(`${first ? '' : ','}${JSON.stringify(row)}`);
      first = false;
    },
    async close(summary) {
      stream.write(`],"summary":${JSON.stringify(summary)} }\n`);
      await new Promise((resolve, reject) => { stream.once('finish', resolve); stream.once('error', reject); stream.end(); });
    },
  };
}

async function run(options = {}) {
  const parsed = { ...parseArgs([]), ...options };
  parsed.batchSize = normalizeBatchSize(parsed.batchSize);
  parsed.runId = parsed.runId || `growth-prospect-import-${Date.now()}`;
  parsed.receipt = parsed.receipt || path.resolve(process.cwd(), 'growth-os-receipts', `${parsed.runId}.json`);
  const startedAt = new Date().toISOString();
  const counts = { created: 0, skippedDuplicate: 0, wouldCreate: 0, failed: 0 };
  const writer = receiptWriter(parsed.receipt, {
    schemaVersion: 1, runId: parsed.runId, dryRun: !parsed.apply, apply: Boolean(parsed.apply),
    batchSize: parsed.batchSize, startedAt, restartSemantics: 'Rerun with the same source references is idempotent; the receipt is an execution record, not a checkpoint.',
  });
  const reservations = { sourceReferences: new Set(), identityKeys: new Set() };
  let total = 0;
  try {
    for await (const row of loadRows({ batchSize: parsed.batchSize })) {
      total += 1;
      try {
        const result = await prospectService.createImported({
          data: row.data, source: row.source, sourceReference: row.sourceReference,
          dryRun: !parsed.apply, runId: parsed.runId, reservations,
          activationEvidenceAt: row.activationEvidenceAt || null,
        });
        const outcome = result.created ? 'created' : result.skippedDuplicate ? 'skipped-duplicate' : 'would-create';
        counts[result.created ? 'created' : result.skippedDuplicate ? 'skippedDuplicate' : 'wouldCreate'] += 1;
        const receiptRow = { source: row.source, sourceReference: row.sourceReference, outcome,
          conflictingProspectId: result.conflictingProspectId || null };
        writer.append(receiptRow);
      } catch (error) {
        counts.failed += 1;
        writer.append({ source: row.source, sourceReference: row.sourceReference, outcome: 'failed', error: error.code || 'INTERNAL_ERROR' });
      }
    }
  } catch (error) {
    counts.failed += 1;
    writer.append({ outcome: 'failed', error: error.code || 'SOURCE_READ_FAILED' });
  }
  const result = { dryRun: !parsed.apply, runId: parsed.runId, receipt: parsed.receipt, total, counts };
  await writer.close({ ...result, completedAt: new Date().toISOString() });
  return result;
}

module.exports = { run, loadRows, parseArgs, crmImportRow, partnerImportRow, normalizeBatchSize };

if (require.main === module) {
  let options;
  run(options = parseArgs(process.argv.slice(2)))
    .then((result) => { console.log(JSON.stringify(result, null, 2)); if (result.counts.failed > 0) process.exitCode = 1; })
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { const { sequelize } = require('../src/utils/database/database-setup'); await sequelize.close(); });
}
