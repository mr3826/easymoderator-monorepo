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
const prospectRepository = require('../growth-os.prospect.repository');
const app = require('../../../app');

const API_ROOT = '/api/internal/growth-os/prospects';

let founder;
let executive;
let merchant;
let marketer;
let tenant;
let shop;
let founderToken;
let executiveToken;
let marketerToken;
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

function asMarketer() {
  return {
    get: (path) => request(app).get(path).set('Authorization', `Bearer ${marketerToken}`),
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
    merchant = await User.create({
      email: `growth-merchant-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Ordinary Merchant',
      phone: phoneFor(`merchant-${suffix}`),
      token_version: 0,
      settings: {},
    });
    marketer = await User.create({
      email: `growth-marketer-${suffix}@example.test`,
      password: 'integration-only',
      full_name: 'Growth Marketer',
      phone: phoneFor(`marketer-${suffix}`),
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
      {
        user_id: marketer.id,
        role: 'MARKETER',
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
    marketerToken = generateAccessToken({
      userId: marketer.id,
      email: marketer.email,
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
    await GrowthOsUserRole.destroy({ where: { user_id: { [Op.in]: [founder.id, executive.id, marketer.id] } } });
    await User.destroy({ where: { id: { [Op.in]: [founder.id, executive.id, merchant.id, marketer.id] } } });
    await Shop.destroy({ where: { id: shop.id } });
    await Tenant.destroy({ where: { id: tenant.id } });
    // The integration runner owns the shared PostgreSQL and Redis clients.
  });

  it('applies the merged-aware source-reference index migration', async () => {
    const [indexes] = await sequelize.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'growth_os_prospects_source_reference_uq'
    `);

    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(/source_reference/);
    expect(indexes[0].indexdef).toMatch(/status.*merged/i);
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

    const duplicateCheck = await asFounder().get(`${API_ROOT}/duplicate-check`).query({
      contactPhone: payload.contactPhone,
      contactEmail: payload.contactEmail,
      pageUrl: payload.pageUrl,
    });
    expect(duplicateCheck.status).toBe(200);
    expect(duplicateCheck.body.data.matches).toEqual([
      expect.objectContaining({
        prospectId,
        matchedFields: expect.arrayContaining(['contactPhone', 'contactEmail', 'pageUrl']),
      }),
    ]);
    const excludedDuplicateCheck = await asFounder().get(`${API_ROOT}/duplicate-check`).query({
      contactEmail: payload.contactEmail,
      excludeId: prospectId,
    });
    expect(excludedDuplicateCheck.status).toBe(200);
    expect(excludedDuplicateCheck.body.data.matches).toHaveLength(0);

    const detail = await asFounder().get(`${API_ROOT}/${prospectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'created' }),
    ]));
    const pagedDetail = await asFounder()
      .get(`${API_ROOT}/${prospectId}`)
      .query({ timelinePage: 1, timelinePageSize: 1 });
    expect(pagedDetail.status).toBe(200);
    expect(pagedDetail.body.data.timeline).toHaveLength(1);
    expect(pagedDetail.body.data.timelinePagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });

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

    const invalidTransition = await asFounder()
      .post(`${API_ROOT}/${prospectId}/status`)
      .send({ status: 'qualified' });
    expect(invalidTransition.status).toBe(409);
    expect(invalidTransition.body.code).toBe('GROWTH_OS_PROSPECT_INVALID_TRANSITION');

    const assigned = await asFounder()
      .post(`${API_ROOT}/${prospectId}/assign`)
      .send({ ownerUserId: executive.id, reason: 'Assigned for follow-up' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ownerUserId).toBe(executive.id);

    const unassigned = await asFounder()
      .post(`${API_ROOT}/${prospectId}/assign`)
      .send({ ownerUserId: null, reason: 'Cleared temporary owner' });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.ownerUserId).toBeNull();

    const invalidLinkTarget = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: 'dddddddd-dddd-4ddd-8ddd-000000000000', reason: 'Missing shop probe' });
    expect(invalidLinkTarget.status).toBe(404);

    const linked = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: shop.id, reason: 'Verified matching shop' });
    expect(linked.status).toBe(200);
    expect(linked.body.data.linkedShopId).toBe(shop.id);

    const unlinked = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: null, userId: null, reason: 'Removed stale shop link' });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data.linkedShopId).toBeNull();

    const relinked = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: shop.id, reason: 'Restored verified shop link' });
    expect(relinked.status).toBe(200);

    const converted = await asFounder()
      .post(`${API_ROOT}/${prospectId}/status`)
      .send({ status: 'converted', reason: 'Shop linkage verified' });
    expect(converted.status).toBe(200);
    expect(converted.body.data).toMatchObject({
      status: 'converted',
      linkedShopId: shop.id,
      eligibleForNextPhase: false,
    });

    const convertedUnlink = await asFounder()
      .post(`${API_ROOT}/${prospectId}/link`)
      .send({ shopId: null, userId: null, reason: 'Attempted converted unlink' });
    expect(convertedUnlink.status).toBe(400);
    expect(convertedUnlink.body.code).toBe('GROWTH_OS_PROSPECT_INVALID_INPUT');

    const finalDetail = await asFounder().get(`${API_ROOT}/${prospectId}`);
    expect(finalDetail.status).toBe(200);
    expect(finalDetail.body.data.timeline.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['created', 'updated', 'status_changed', 'assigned', 'unassigned', 'linked', 'unlinked']),
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
    expect(conflictingEdit.body.conflictingProspectId).toBe(foreignId);

  });

  it('allows exactly one concurrent create and returns one duplicate conflict', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(suffix, {
      businessName: `Concurrent Prospect ${suffix}`,
      contactPhone: phoneFor(`concurrent-${suffix}`, '018'),
      contactEmail: `concurrent-${suffix}@example.test`,
      pageUrl: `https://facebook.com/concurrent-${suffix}`,
    });

    const originalFindDuplicates = prospectRepository.findDuplicateProspects;
    const duplicateSpy = jest.spyOn(prospectRepository, 'findDuplicateProspects')
      .mockImplementation(async (identity, options = {}) => {
        if (options.transaction) return [];
        return originalFindDuplicates(identity, options);
      });
    let responses;
    try {
      responses = await Promise.all([
        createProspect(founderToken, payload),
        createProspect(founderToken, payload),
      ]);
    } finally {
      duplicateSpy.mockRestore();
    }
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

  it('enforces marketer source scope and redaction on real PostgreSQL', async () => {
    const suffix = fixtureSuffix();
    const marketing = await createProspect(founderToken, prospectPayload(`marketing-${suffix}`, {
      source: 'partner_form',
      sourceReference: `marketing:${suffix}`,
      contactPhone: phoneFor(`0${suffix}`, '018'),
      contactEmail: `marketing-${suffix}@example.test`,
      pageUrl: `https://facebook.com/marketing-${suffix}`,
      notes: 'Private marketing note',
      metadata: { internal: 'private' },
    }));
    const marketingId = rememberProspect(marketing);
    const manual = await createProspect(founderToken, prospectPayload(`manual-${suffix}`, {
      source: 'manual_entry',
      contactPhone: phoneFor(`1${suffix}`, '018'),
      contactEmail: `manual-${suffix}@example.test`,
      pageUrl: `https://facebook.com/manual-${suffix}`,
      notes: 'Manual private note',
      metadata: { internal: 'private' },
    }));
    const manualId = rememberProspect(manual);

    const listed = await asMarketer().get(API_ROOT);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.map((item) => item.id)).toContain(marketingId);
    expect(listed.body.data.items.map((item) => item.id)).not.toContain(manualId);
    expect(listed.body.data.items.find((item) => item.id === marketingId)).toMatchObject({
      notes: null,
      metadata: null,
      redacted: true,
    });

    const detail = await asMarketer().get(`${API_ROOT}/${marketingId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ notes: null, metadata: null, redacted: true });
    expect(detail.body.data.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: null, metadata: null }),
    ]));
    expect(JSON.stringify(detail.body)).not.toContain(founder.email);
    expect(JSON.stringify(detail.body)).not.toContain('Growth Founder');

    const manualDetail = await asMarketer().get(`${API_ROOT}/${manualId}`);
    expect(manualDetail.status).toBe(404);
  });

  it('rejects assignment to a user without an active Growth OS role', async () => {
    const suffix = fixtureSuffix();
    const created = await createProspect(founderToken, prospectPayload(`invalid-owner-${suffix}`));
    const prospectId = rememberProspect(created);

    const response = await asFounder()
      .post(`${API_ROOT}/${prospectId}/assign`)
      .send({ ownerUserId: merchant.id, reason: 'Reject non-operator owner' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('GROWTH_OS_PROSPECT_INVALID_OWNER');
    expect((await GrowthOsProspect.findByPk(prospectId)).owner_user_id).toBeNull();
  });

  it('allows a new source record to reuse a merged source reference', async () => {
    const suffix = fixtureSuffix();
    const source = await createProspect(founderToken, prospectPayload(`source-ref-${suffix}`, {
      source: 'partner_form',
      sourceReference: `partner:${suffix}`,
      contactPhone: phoneFor(`0${suffix}`, '018'),
      contactEmail: `source-ref-${suffix}@example.test`,
      pageUrl: `https://facebook.com/source-ref-${suffix}`,
    }));
    const sourceId = rememberProspect(source);
    const target = await createProspect(founderToken, prospectPayload(`source-ref-target-${suffix}`, {
      source: 'partner_form',
      contactPhone: phoneFor(`1${suffix}`, '018'),
      contactEmail: `source-ref-target-${suffix}@example.test`,
      pageUrl: `https://facebook.com/source-ref-target-${suffix}`,
    }));
    const targetId = rememberProspect(target);

    const merged = await asFounder()
      .post(`${API_ROOT}/${sourceId}/merge`)
      .send({ targetProspectId: targetId, reason: 'Free the source reference after merge' });
    expect(merged.status).toBe(200);

    const mergedUpdate = await asFounder()
      .patch(`${API_ROOT}/${sourceId}`)
      .send({ notes: 'Merged records stay immutable' });
    expect(mergedUpdate.status).toBe(409);
    expect(mergedUpdate.body.code).toBe('GROWTH_OS_PROSPECT_MERGED');

    const replacement = await createProspect(founderToken, prospectPayload(`source-ref-replacement-${suffix}`, {
      source: 'partner_form',
      sourceReference: `partner:${suffix}`,
      contactPhone: phoneFor(`2${suffix}`, '019'),
      contactEmail: `source-ref-replacement-${suffix}@example.test`,
      pageUrl: `https://facebook.com/source-ref-replacement-${suffix}`,
    }));
    expect(replacement.status).toBe(201);
    rememberProspect(replacement);
  });

  it('round-trips non-Bangladesh phone numbers without changing their country code', async () => {
    const suffix = fixtureSuffix();
    const payload = prospectPayload(`international-${suffix}`, {
      contactPhone: '+1 415 555 1234',
      contactEmail: `international-${suffix}@example.test`,
      pageUrl: `https://facebook.com/international-${suffix}`,
    });
    const created = await createProspect(founderToken, payload);
    const prospectId = rememberProspect(created);

    expect(created.status).toBe(201);
    expect(created.body.data.contactPhone).toBe(payload.contactPhone);

    const row = await GrowthOsProspect.findByPk(prospectId);
    expect(row.normalized_phone).toBe('+14155551234');
  });

  it('escapes percent, underscore, and backslash search characters', async () => {
    const suffix = fixtureSuffix();
    const literal = await createProspect(founderToken, prospectPayload(`literal-${suffix}`, {
      businessName: `Literal %_\\ ${suffix}`,
      contactName: `Literal %_\\ ${suffix}`,
      contactPhone: phoneFor(`literal-${suffix}`, '018'),
      contactEmail: `literal-${suffix}@example.test`,
      pageUrl: `https://facebook.com/literal-${suffix}`,
    }));
    const literalId = rememberProspect(literal);
    const broad = await createProspect(founderToken, prospectPayload(`broad-${suffix}`, {
      businessName: `Broad Search ${suffix}`,
      contactPhone: phoneFor(`broad-${suffix}`, '019'),
      contactEmail: `broad-${suffix}@example.test`,
      pageUrl: `https://facebook.com/broad-${suffix}`,
    }));
    const broadId = rememberProspect(broad);

    const percent = await asFounder().get(API_ROOT).query({ q: '%' });
    expect(percent.status).toBe(200);
    expect(percent.body.data.items.map((item) => item.id)).toContain(literalId);
    expect(percent.body.data.items.map((item) => item.id)).not.toContain(broadId);

    const underscore = await asFounder().get(API_ROOT).query({ q: '_' });
    expect(underscore.status).toBe(200);
    expect(underscore.body.data.items.map((item) => item.id)).toContain(literalId);
    expect(underscore.body.data.items.map((item) => item.id)).not.toContain(broadId);

    const backslash = await asFounder().get(API_ROOT).query({ q: '\\' });
    expect(backslash.status).toBe(200);
    expect(backslash.body.data.items.map((item) => item.id)).toContain(literalId);
    expect(backslash.body.data.items.map((item) => item.id)).not.toContain(broadId);
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
    const rolledBackEvents = await GrowthOsProspectEvent.findAll({
      include: [{
        model: GrowthOsProspect,
        as: 'prospect',
        attributes: [],
        required: true,
        where: { normalized_email: payload.contactEmail.toLowerCase() },
      }],
    });
    expect(rolledBackEvents).toHaveLength(0);
  });
});
