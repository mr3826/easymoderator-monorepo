'use strict';

const { Op } = require('sequelize');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  AuditLog, GrowthOsProspect, GrowthOsProspectEvent, PartnerApplication, Shop, Tenant, User,
} = require('../../entities');
const { run } = require('../../../../scripts/import-growth-prospects');
const prospectService = require('../growth-os.prospect.service');

let sourceUser;
let crmLead;
let partnerApplication;
let duplicatePartnerApplication;
let tombstonePartnerApplication;
let sourceReferences;
const activationFixtures = [];
const receiptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-import-'));

function receiptRows(result) {
  return JSON.parse(fs.readFileSync(result.receipt, 'utf8')).rows;
}

function suffix() {
  return uuidv4().replace(/-/g, '').slice(0, 12);
}

function phoneFor(seed, prefix) {
  const digits = [...seed]
    .map((character) => /[0-9]/.test(character) ? character : String(character.charCodeAt(0) % 10))
    .join('')
    .padEnd(8, '7')
    .slice(0, 8);
  return `${prefix}${digits}`;
}

async function removeImportedFixtures() {
  if (sourceReferences?.length) {
    const imported = await GrowthOsProspect.findAll({
      where: { source_reference: { [Op.in]: sourceReferences } },
      attributes: ['id'],
    });
    const importedIds = imported.map((row) => row.id);
    if (importedIds.length) {
      await GrowthOsProspectEvent.destroy({ where: { prospect_id: { [Op.in]: importedIds } } });
      await AuditLog.destroy({
        where: {
          resource_type: 'growth_os_prospect',
          resource_id: { [Op.in]: importedIds },
        },
      });
      await GrowthOsProspect.destroy({ where: { id: { [Op.in]: importedIds } } });
    }
  }
  if (crmLead) await AuditLog.destroy({ where: { id: crmLead.id } });
  if (partnerApplication) await PartnerApplication.destroy({ where: { id: partnerApplication.id } });
  if (duplicatePartnerApplication) await PartnerApplication.destroy({ where: { id: duplicatePartnerApplication.id } });
  if (tombstonePartnerApplication) await PartnerApplication.destroy({ where: { id: tombstonePartnerApplication.id } });
  if (sourceUser) await User.destroy({ where: { id: sourceUser.id } });
  for (const activation of activationFixtures) {
    await AuditLog.destroy({ where: { id: activation.lead.id } });
    await User.destroy({ where: { id: activation.owner.id } });
    await Shop.destroy({ where: { id: activation.shop.id } });
    await Tenant.destroy({ where: { id: activation.tenant.id } });
  }
}

describe('Growth OS prospect import on real PostgreSQL', () => {
  beforeAll(async () => {
    const id = suffix();
    sourceUser = await User.create({
      email: `growth-import-${id}@example.test`,
      password: 'integration-only',
      full_name: 'Imported Signup Owner',
      phone: phoneFor(`user-${id}`, '019'),
      token_version: 0,
      settings: {},
    });
    crmLead = await AuditLog.create({
      user_id: sourceUser.id,
      shop_id: null,
      action: 'crm:lead_created',
      resource_type: 'crm_lead',
      resource_id: `crm-lead-${id}`,
      idempotency_key: `phase3-crm-${id}`,
      metadata: {
        lead_source: 'signup',
        business_name: `Imported Signup ${id}`,
        status: 'qualifying',
        next_action: 'Call after signup',
      },
      created_at: new Date('2026-08-20T00:00:00.000Z'),
    });
    partnerApplication = await PartnerApplication.create({
      business_name: `Imported Partner ${id}`,
      phone: phoneFor(`partner-${id}`, '018'),
      page_link: `https://facebook.com/imported-partner-${id}`,
      status: 'pending',
      notes: 'Partner source fixture',
    });
    duplicatePartnerApplication = await PartnerApplication.create({
      business_name: `Duplicate Imported Partner ${id}`,
      phone: partnerApplication.phone,
      page_link: `https://facebook.com/duplicate-imported-partner-${id}`,
      status: 'pending',
      notes: 'Duplicate partner source fixture',
    });
    sourceReferences = [
      crmLead.idempotency_key,
      `partner_application:${partnerApplication.id}`,
      `partner_application:${duplicatePartnerApplication.id}`,
    ];
  });

  afterAll(async () => {
    await removeImportedFixtures();
    // Do not close shared Sequelize or Redis clients.
  });

  it('supports dry-run, idempotent apply, and leaves both source tables unchanged', async () => {
    const crmBefore = await AuditLog.findByPk(crmLead.id, { raw: true });
    const partnerBefore = await PartnerApplication.findByPk(partnerApplication.id, { raw: true });

    const dryRun = await run({ apply: false, runId: `dry-${suffix()}`, receipt: path.join(receiptDirectory, 'dry.json') });
    const dryRunFixtures = receiptRows(dryRun).filter((result) => sourceReferences.includes(result.sourceReference));
    expect(dryRun.dryRun).toBe(true);
    expect(dryRunFixtures).toHaveLength(3);
    expect(dryRunFixtures.filter((result) => result.outcome === 'would-create')).toHaveLength(2);
    expect(dryRunFixtures.filter((result) => result.outcome === 'skipped-duplicate')).toHaveLength(1);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(0);

    const firstApply = await run({ apply: true, runId: `apply-${suffix()}`, receipt: path.join(receiptDirectory, 'first.json') });
    const firstFixtures = receiptRows(firstApply).filter((result) => sourceReferences.includes(result.sourceReference));
    expect(firstFixtures).toHaveLength(3);
    expect(firstFixtures.filter((result) => result.outcome === 'created')).toHaveLength(2);
    expect(firstFixtures.filter((result) => result.outcome === 'skipped-duplicate')).toHaveLength(1);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(2);

    const secondApply = await run({ apply: true, runId: `repeat-${suffix()}`, receipt: path.join(receiptDirectory, 'second.json') });
    const secondFixtures = receiptRows(secondApply).filter((result) => sourceReferences.includes(result.sourceReference));
    expect(secondFixtures).toHaveLength(3);
    expect(secondFixtures.every((result) => result.outcome === 'skipped-duplicate')).toBe(true);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(2);

    const importedEvent = await GrowthOsProspectEvent.findOne({
      where: { prospect_id: { [Op.in]: await GrowthOsProspect.findAll({
        where: { source_reference: crmLead.idempotency_key }, attributes: ['id'], raw: true,
      }).then((rows) => rows.map((row) => row.id)) } },
    });
    expect(importedEvent.metadata).toMatchObject({ import_run_id: expect.any(String) });
    const importedAudit = await AuditLog.findOne({
      where: { resource_type: 'growth_os_prospect', resource_id: importedEvent.prospect_id },
    });
    expect(importedAudit.metadata).toMatchObject({ import_run_id: expect.any(String) });

    const crmAfter = await AuditLog.findByPk(crmLead.id, { raw: true });
    const partnerAfter = await PartnerApplication.findByPk(partnerApplication.id, { raw: true });
    expect(crmAfter).toMatchObject({
      id: crmBefore.id,
      resource_type: crmBefore.resource_type,
      resource_id: crmBefore.resource_id,
      idempotency_key: crmBefore.idempotency_key,
      metadata: crmBefore.metadata,
    });
    expect(partnerAfter).toMatchObject({
      id: partnerBefore.id,
      business_name: partnerBefore.business_name,
      phone: partnerBefore.phone,
      page_link: partnerBefore.page_link,
      status: partnerBefore.status,
      notes: partnerBefore.notes,
    });
  });

  it('backfills canonical activated events only where linked-shop evidence exists', async () => {
    const id = suffix();
    async function activationFixture(tag, settings) {
      const tenant = await Tenant.create({ name: `Activation import ${id}-${tag}` });
      const shop = await Shop.create({
        unique_code: `act${tag}${id.slice(0, 8)}`,
        tenant_id: tenant.id,
        shop_name: `Activation Shop ${id} ${tag}`,
        name: `Activation Shop ${id} ${tag}`,
        is_active: true,
        settings,
      });
      const owner = await User.create({
        email: `activation-${tag}-${id}@example.test`,
        password: 'integration-only',
        full_name: `Activation Owner ${tag}`,
        phone: phoneFor(`${tag}-${id}`, '019'),
        token_version: 0,
        settings: {},
      });
      const key = `phase3-act-${id}-${tag}`;
      const lead = await AuditLog.create({
        user_id: owner.id,
        shop_id: shop.id,
        action: 'crm:lead_created',
        resource_type: 'crm_lead',
        resource_id: `crm-lead-${id}-${tag}`,
        idempotency_key: key,
        metadata: {
          lead_source: 'signup',
          business_name: `Activation Evidence ${id} ${tag}`,
          status: 'converted',
        },
        created_at: new Date('2026-09-01T00:00:00.000Z'),
      });
      sourceReferences.push(key);
      const fixture = { tenant, shop, owner, lead, key };
      activationFixtures.push(fixture);
      return fixture;
    }

    const evidenced = await activationFixture('a', {
      first_ai_reply: { occurred_at: '2026-09-05T10:00:00.000Z' },
    });
    const bare = await activationFixture('b', {});

    const applied = await run({
      apply: true,
      runId: `activation-${suffix()}`,
      receipt: path.join(receiptDirectory, `activation-${id}.json`),
    });
    expect(applied.counts.failed).toBe(0);

    const [evidencedRow, bareRow] = await Promise.all([
      GrowthOsProspect.findOne({ where: { source_reference: evidenced.key }, raw: true }),
      GrowthOsProspect.findOne({ where: { source_reference: bare.key }, raw: true }),
    ]);
    expect(evidencedRow.status).toBe('converted');
    expect(bareRow.status).toBe('converted');

    const evidencedEvents = await GrowthOsProspectEvent.findAll({
      where: { prospect_id: evidencedRow.id },
      raw: true,
    });
    const backfilled = evidencedEvents.filter((event) => event.event_type === 'activated');
    expect(backfilled).toHaveLength(1);
    expect(new Date(backfilled[0].created_at).toISOString()).toBe('2026-09-05T10:00:00.000Z');
    expect(backfilled[0].metadata).toMatchObject({
      activation_backfill: true,
      evidence: 'linked_shop.first_ai_reply',
    });

    const bareActivated = await GrowthOsProspectEvent.findAll({
      where: { prospect_id: bareRow.id, event_type: 'activated' },
      raw: true,
    });
    expect(bareActivated).toHaveLength(0);

    // Re-running the importer over the same sources must duplicate nothing.
    await run({
      apply: true,
      runId: `activation-repeat-${suffix()}`,
      receipt: path.join(receiptDirectory, `activation-repeat-${id}.json`),
    });
    expect(await GrowthOsProspectEvent.count({
      where: { prospect_id: evidencedRow.id, event_type: 'activated' },
    })).toBe(1);
  });

  it('re-links an importer record when its prior source reference is merged', async () => {
    const id = suffix();
    tombstonePartnerApplication = await PartnerApplication.create({
      business_name: `Merged importer source ${id}`,
      phone: phoneFor(`source-${id}`, '018'),
      page_link: `https://facebook.com/merged-source-${id}`,
      status: 'pending',
      notes: 'Tombstone source fixture',
    });
    const sourceReference = `partner_application:${tombstonePartnerApplication.id}`;
    const targetReference = `partner_tombstone_target:${id}`;
    sourceReferences.push(sourceReference, targetReference);

    const source = await prospectService.createImported({
      source: 'partner_form',
      sourceReference,
      dryRun: false,
      data: {
        businessName: tombstonePartnerApplication.business_name,
        contactPhone: tombstonePartnerApplication.phone,
        pageUrl: tombstonePartnerApplication.page_link,
        notes: tombstonePartnerApplication.notes,
        sourceDetail: 'partner_form',
      },
    });
    const target = await prospectService.createImported({
      source: 'partner_form',
      sourceReference: targetReference,
      dryRun: false,
      data: {
        businessName: `Merged importer target ${id}`,
        contactPhone: phoneFor(`target-${id}`, '018'),
        contactEmail: `merged-target-${id}@example.test`,
        pageUrl: `https://facebook.com/merged-target-${id}`,
      },
    });

    await source.prospect.update({
      status: 'merged',
      merged_into_id: target.prospect.id,
      merged_at: new Date(),
    });

    const applied = await run({ apply: true, runId: `tombstone-${suffix()}`, receipt: path.join(receiptDirectory, 'tombstone.json') });
    const replacement = receiptRows(applied).find((result) => result.sourceReference === sourceReference);

    expect(replacement).toMatchObject({ sourceReference, outcome: 'created' });
    expect(applied.counts.failed).toBe(0);
    expect(await GrowthOsProspect.count({ where: { source_reference: sourceReference } })).toBe(2);
  });
});
