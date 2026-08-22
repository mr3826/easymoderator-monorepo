'use strict';

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { AuditLog, GrowthOsProspect, GrowthOsProspectEvent, PartnerApplication, User } = require('../../entities');
const { run } = require('../../../../scripts/import-growth-prospects');
const prospectService = require('../growth-os.prospect.service');

let sourceUser;
let crmLead;
let partnerApplication;
let tombstonePartnerApplication;
let sourceReferences;

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
  if (tombstonePartnerApplication) await PartnerApplication.destroy({ where: { id: tombstonePartnerApplication.id } });
  if (sourceUser) await User.destroy({ where: { id: sourceUser.id } });
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
    sourceReferences = [
      crmLead.idempotency_key,
      `partner_application:${partnerApplication.id}`,
    ];
  });

  afterAll(async () => {
    await removeImportedFixtures();
    // Do not close shared Sequelize or Redis clients.
  });

  it('supports dry-run, idempotent apply, and leaves both source tables unchanged', async () => {
    const crmBefore = await AuditLog.findByPk(crmLead.id, { raw: true });
    const partnerBefore = await PartnerApplication.findByPk(partnerApplication.id, { raw: true });

    const dryRun = await run({ apply: false });
    const dryRunFixtures = dryRun.results.filter((result) => sourceReferences.includes(result.sourceReference));
    expect(dryRun.dryRun).toBe(true);
    expect(dryRunFixtures).toHaveLength(2);
    expect(dryRunFixtures.every((result) => result.outcome === 'would-create')).toBe(true);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(0);

    const firstApply = await run({ apply: true });
    const firstFixtures = firstApply.results.filter((result) => sourceReferences.includes(result.sourceReference));
    expect(firstFixtures).toHaveLength(2);
    expect(firstFixtures.every((result) => result.outcome === 'created')).toBe(true);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(2);

    const secondApply = await run({ apply: true });
    const secondFixtures = secondApply.results.filter((result) => sourceReferences.includes(result.sourceReference));
    expect(secondFixtures).toHaveLength(2);
    expect(secondFixtures.every((result) => result.outcome === 'skipped-duplicate')).toBe(true);
    expect(await GrowthOsProspect.count({
      where: { source_reference: { [Op.in]: sourceReferences } },
    })).toBe(2);

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

    const applied = await run({ apply: true });
    const replacement = applied.results.find((result) => result.sourceReference === sourceReference);

    expect(replacement).toMatchObject({ sourceReference, outcome: 'created' });
    expect(applied.counts.failed).toBe(0);
    expect(await GrowthOsProspect.count({ where: { source_reference: sourceReference } })).toBe(2);
  });
});
