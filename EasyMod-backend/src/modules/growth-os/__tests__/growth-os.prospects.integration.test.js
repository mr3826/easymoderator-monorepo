'use strict';

const request = require('supertest');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { generateAccessToken } = require('../../../utils/jwt.util');
const { sequelize } = require('../../../utils/database/database-setup');
const {
  AuditLog,
  GrowthOsProspect,
  GrowthOsProspectEvent,
  GrowthOsUserRole,
  Shop,
  Tenant,
  User,
} = require('../../entities');
const app = require('../../../app');

const API_ROOT = '/api/internal/growth-os/prospects';

let founder;
let executive;
let tenant;
let shop;
let founderToken;
let executiveToken;
const prospectIds = new Set();

function fixtureSuffix() {
  return uuidv4().replace(/-/g, '').slice(0, 12);
}

function numericToken(seed) {
  return [...seed]
    .map((character) => /[0-9]/.test(character) ? character : String(character.charCodeAt(0) % 10))
    .join('')
    .padEnd(8, '7')
    .slice(0, 8);
}

function phoneFor(seed, prefix = '017') {
  return `${prefix}${numericToken(seed)}`;
}

function rememberProspect(response) {
  const id = response.body?.data?.id;
  if (id) prospectIds.add(id);
  return id;
}

function asFounder() {
  return {
    get: (path) => request(app).get(path).set('Authorization', `Bearer ${founderToken}`),
    patch: (path) => request(app).patch(path).set('Authorization', `Bearer ${founderToken}`),
    post: (path) => request(app).post(path).set('Authorization', `Bearer ${founderToken}`),
  };
}

function asExecutive() {
  return {
    get: (path) => request(app).get(path).set('Authorization', `Bearer ${executiveToken}`),
    patch: (path) => request(app).patch(path).set('Authorization', `Bearer ${executiveToken}`),
  };
}

async function createProspect(token, data) {
  return request(app)
    .post(API_ROOT)
    .set('Authorization', `Bearer ${token}`)
    .send(data);
}

function prospectPayload(suffix, overrides = {}) {
  return {
    businessName: `Phase 3 Prospect ${suffix}`,
    contactName: 'Integration Owner',
    contactPhone: phoneFor(`base-${suffix}`),
    contactEmail: `phase3-${suffix}@example.test`,
    pageUrl: `https://m.facebook.com/phase3-${suffix}/?source=integration`,
    niche: 'retail',
    source: 'manual_entry',
    sourceDetail: 'phase-3-integration',
    notes: 'Integration fixture',
    ...overrides,
  };
}

async function removeProspects() {
  const ids = [...prospectIds];
  if (ids.length === 0) return;
  await GrowthOsProspectEvent.destroy({ where: { prospect_id: { [Op.in]: ids } } });
  await AuditLog.destroy({
    where: {
      resource_type: 'growth_os_prospect',
      resource_id: { [Op.in]: ids },
    },
  });
  await GrowthOsProspect.destroy({ where: { id: { [Op.in]: ids } } });
  prospectIds.clear();
}

describe('Growth OS prospects on real PostgreSQL and Redis', () => {
  beforeAll(async () => {
    const suffix = fixtureSuffix();
    tenant = await Tenant.create({ name: `Growth OS integration ${suffix}` });
    shop = await Shop.create({
      unique_code: `p3${suffix}`,
      tenant_id: tenant.id,
      shop_name: `Growth OS shop ${suffix}`,
      name: `Growth OS shop ${suffix}`,
      is_active: true,
    });
    founder = await User.create({
      email: `growth-founder-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Growth Founder',
      phone: phoneFor(`founder-${suffix}`),
      token_version: 0,
      settings: {},
    });
    executive = await User.create({
      email: `growth-executive-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Growth Executive',
      phone: phoneFor(`executive-${suffix}`),
      token_version: 0,
      settings: {},
    });
    await GrowthOsUserRole.bulkCreate([
      {
        user_id: founder.id,
        role: 'FOUNDER',
        is_active: true,
        granted_by: founder.id,
        metadata: { source: 'prospect_integration_fixture' },
      },
      {
        user_id: executive.id,
        role: 'BUSINESS_EXECUTIVE',
        is_active: true,
        granted_by: founder.id,
        metadata: { source: 'prospect_integration_fixture' },
      },
    ]);

    founderToken = generateAccessToken({
      userId: founder.id,
      email: founder.email,
      shopId: shop.id,
      tokenVersion: 0,
      mfaVerified: true,
    });
    executiveToken = generateAccessToken({
      userId: executive.id,
      email: executive.email,
      shopId: shop.id,
      tokenVersion: 0,
      mfaVerified: false,
    });
  });

  afterEach(async () => {
    await removeProspects();
  });

  afterAll(async () => {
    await removeProspects();
    await GrowthOsUserRole.destroy({ where: { user_id: { [Op.in]: [founder.id, executive.id] } } });
    await User.destroy({ where: { id: { [Op.in]: [founder.id, executive.id] } } });
    await Shop.destroy({ where: { id: shop.id } });
    await Tenant.destroy({ where: { id: tenant.id } });
    // The integration runner owns the shared PostgreSQL and Redis clients.
  });

  it('creates, lists, details, edits, transitions, assigns, links, and converts a prospect', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(suffix);
    const created = await createProspect(founderToken, payload);
    const prospectId = rememberProspect(created);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: prospectId,
      businessName: payload.businessName,
      contactPhone: payload.contactPhone,
      contactEmail: payload.contactEmail,
      source: 'manual_entry',
      status: 'new',
    });

    const listed = await asFounder().get(API_ROOT).query({ q: payload.businessName });
    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.items[0].id).toBe(prospectId);

    const searchedByContact = await asFounder().get(API_ROOT).query({ q: payload.contactName });
    expect(searchedByContact.status).toBe(200);
    expect(searchedByContact.body.data.items).toHaveLength(1);
    expect(searchedByContact.body.data.items[0].id).toBe(prospectId);

    const searchedByEmail = await asFounder().get(API_ROOT).query({ q: payload.contactEmail });
    expect(searchedByEmail.status).toBe(200);
    expect(searchedByEmail.body.data.items).toHaveLength(1);
    expect(searchedByEmail.body.data.items[0].id).toBe(prospectId);

    const detail = await asFounder().get(`${API_ROOT}/${prospectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'created' }),
    ]));

    const edited = await asFounder()
      .patch(`${API_ROOT}/${prospectId}`)
      .send({ businessName: `${payload.businessName} Updated`, notes: 'Edited in integration test' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      businessName: `${payload.businessName} Updated`,
      notes: 'Edited in integration test',
    });

    for (const status of ['contacted', 'qualifying', 'qualified']) {
      const transitioned = await asFounder()
        .post(`${API_ROOT}/${prospectId}/status`)
        .send({ status });
      expect(transitioned.status).toBe(200);
      expect(transitioned.body.data.status).toBe(status);
    }

    const unlinkedConversion = await asFounder()
      .post(`${API_ROOT}/${prospectId}/status`)
      .send({ status: 'converted', reason: 'Conversion must have a shop' });
    expect(unlinkedConversion.status).toBe(400);
    expect(unlinkedConversion.body.code).toBe('GROWTH_OS_PROSPECT_INVALID_INPUT');

    const assigned = await asFounder()
      .post(`${API_ROOT}/${prospectId}/assign`)
      .send({ ownerUserId: executive.id, reason: 'Assigned for follow-up' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ownerUserId).toBe(executive.id);

    const linked = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: shop.id, reason: 'Verified matching shop' });
    expect(linked.status).toBe(200);
    expect(linked.body.data.linkedShopId).toBe(shop.id);

    const converted = await asFounder()
      .post(`${API_ROOT}/${prospectId}/status`)
      .send({ status: 'converted', reason: 'Shop linkage verified' });
    expect(converted.status).toBe(200);
    expect(converted.body.data).toMatchObject({
      status: 'converted',
      linkedShopId: shop.id,
      eligibleForNextPhase: false,
    });

    const finalDetail = await asFounder().get(`${API_ROOT}/${prospectId}`);
    expect(finalDetail.status).toBe(200);
    expect(finalDetail.body.data.timeline.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['created', 'updated', 'status_changed', 'assigned', 'linked']),
    );

    const events = await GrowthOsProspectEvent.findAll({ where: { prospect_id: prospectId } });
    const audits = await AuditLog.findAll({
      where: { resource_type: 'growth_os_prospect', resource_id: prospectId },
    });
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(audits.length).toBe(events.length);
    expect(audits.every((audit) => audit.shop_id === null)).toBe(true);
  });

  it('keeps executive reads and edits inside the assigned scope', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(suffix, {
      sourceReference: `assigned-${suffix}`,
    });
    const created = await createProspect(founderToken, payload);
    const prospectId = rememberProspect(created);

    const unassignedList = await asExecutive().get(API_ROOT).query({ q: payload.businessName });
    expect(unassignedList.status).toBe(200);
    expect(unassignedList.body.data.items).toHaveLength(0);

    const foreignDetail = await asExecutive().get(`${API_ROOT}/${prospectId}`);
    expect(foreignDetail.status).toBe(404);
    expect(foreignDetail.body.code).toBe('GROWTH_OS_PROSPECT_NOT_FOUND');

    const foreignEdit = await asExecutive()
      .patch(`${API_ROOT}/${prospectId}`)
      .send({ businessName: 'Attempted IDOR update' });
    expect(foreignEdit.status).toBe(404);

    const assigned = await asFounder()
      .post(`${API_ROOT}/${prospectId}/assign`)
      .send({ ownerUserId: executive.id, reason: 'Scope fixture assignment' });
    expect(assigned.status).toBe(200);

    const assignedDetail = await asExecutive().get(`${API_ROOT}/${prospectId}`);
    expect(assignedDetail.status).toBe(200);
    expect(assignedDetail.body.data.ownerUserId).toBe(executive.id);

    const executiveEdit = await asExecutive()
      .patch(`${API_ROOT}/${prospectId}`)
      .send({ notes: 'Executive updated assigned record' });
    expect(executiveEdit.status).toBe(200);
    expect(executiveEdit.body.data.notes).toBe('Executive updated assigned record');

    const foreignPayload = prospectPayload(`foreign-${suffix}`, {
      contactPhone: phoneFor(`foreign-${suffix}`, '018'),
      contactEmail: `foreign-${suffix}@example.test`,
      pageUrl: `https://facebook.com/foreign-${suffix}`,
    });
    const foreign = await createProspect(founderToken, foreignPayload);
    const foreignId = rememberProspect(foreign);
    const conflictingEdit = await asExecutive()
      .patch(`${API_ROOT}/${prospectId}`)
      .send({ contactEmail: foreignPayload.contactEmail });
    expect(conflictingEdit.status).toBe(409);
    expect(conflictingEdit.body.code).toBe('GROWTH_OS_PROSPECT_DUPLICATE');
    expect(conflictingEdit.body.conflictingProspectId).toBeUndefined();
    expect(conflictingEdit.body.conflictingProspectId).not.toBe(foreignId);

  });

  it('allows exactly one concurrent create and returns one duplicate conflict', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(suffix, {
      businessName: `Concurrent Prospect ${suffix}`,
      contactPhone: phoneFor(`concurrent-${suffix}`, '018'),
      contactEmail: `concurrent-${suffix}@example.test`,
      pageUrl: `https://facebook.com/concurrent-${suffix}`,
    });

    const responses = await Promise.all([
      createProspect(founderToken, payload),
      createProspect(founderToken, payload),
    ]);
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const createdResponse = responses.find((response) => response.status === 201);
    const duplicateResponse = responses.find((response) => response.status === 409);
    rememberProspect(createdResponse);
    expect(duplicateResponse.body.code).toBe('GROWTH_OS_PROSPECT_DUPLICATE');
    expect(duplicateResponse.body.conflictingProspectId).toBe(createdResponse.body.data.id);

    const rows = await GrowthOsProspect.findAll({
      where: { normalized_email: payload.contactEmail.toLowerCase() },
    });
    expect(rows).toHaveLength(1);
  });

  it('marks a merged source terminal and frees its partial identity unique index', async () => {
    const suffix = fixtureSuffix();
    const sourcePayload = prospectPayload(`source-${suffix}`, {
      contactPhone: phoneFor(`source-${suffix}`, '018'),
      contactEmail: `merge-source-${suffix}@example.test`,
      pageUrl: `https://facebook.com/merge-source-${suffix}`,
    });
    const targetPayload = prospectPayload(`target-${suffix}`, {
      contactPhone: phoneFor(`target-${suffix}`, '018'),
      contactEmail: `merge-target-${suffix}@example.test`,
      pageUrl: `https://facebook.com/merge-target-${suffix}`,
    });
    const source = await createProspect(founderToken, sourcePayload);
    const sourceId = rememberProspect(source);
    const target = await createProspect(founderToken, targetPayload);
    const targetId = rememberProspect(target);

    const merged = await asFounder()
      .post(`${API_ROOT}/${sourceId}/merge`)
      .send({ targetProspectId: targetId, reason: 'Duplicate identity review' });
    expect(merged.status).toBe(200);
    expect(merged.body.data.mergedProspect).toMatchObject({
      id: sourceId,
      status: 'merged',
      mergedIntoId: targetId,
    });

    const replacement = await createProspect(founderToken, {
      businessName: `Replacement ${suffix}`,
      contactPhone: sourcePayload.contactPhone,
      source: 'manual_entry',
    });
    const replacementId = rememberProspect(replacement);
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.id).toBe(replacementId);
  });

  it('rolls back the prospect and event when the real audit insert fails', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(`audit-failure-${suffix}`, {
      contactPhone: phoneFor(`audit-failure-${suffix}`, '018'),
      contactEmail: `audit-failure-${suffix}@example.test`,
      pageUrl: `https://facebook.com/audit-failure-${suffix}`,
    });
    const functionName = `growth_os_test_fail_audit_${suffix}`;
    const triggerName = `growth_os_test_fail_audit_trigger_${suffix}`;

    await sequelize.query(`
      CREATE OR REPLACE FUNCTION ${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'intentional Growth OS audit failure'; END; $$;
    `);
    await sequelize.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      WHEN (NEW.resource_type = 'growth_os_prospect')
      EXECUTE FUNCTION ${functionName}();
    `);

    let failed;
    try {
      failed = await createProspect(founderToken, payload);
    } finally {
      await sequelize.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs;`);
      await sequelize.query(`DROP FUNCTION IF EXISTS ${functionName}();`);
    }

    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      code: 'GROWTH_OS_PROSPECT_UNAVAILABLE',
      message: 'Growth OS prospect service is temporarily unavailable.',
    });
    expect(await GrowthOsProspect.count({
      where: { normalized_email: payload.contactEmail.toLowerCase() },
    })).toBe(0);
  });
});
