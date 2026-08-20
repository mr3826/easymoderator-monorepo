'use strict';

const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { AuditLog, GrowthOsProspect, GrowthOsProspectEvent, PartnerApplication, User } = require('../../entities');
const { run } = require('../../../../scripts/import-growth-prospects');

let sourceUser;
let crmLead;
let partnerApplication;
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
});
