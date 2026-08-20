'use strict';

const mockEventCreate = jest.fn();
const mockAuditCreate = jest.fn();
const mockTransaction = {};
const mockSequelize = {
  transaction: jest.fn(),
};
const mockRepository = {
  findProspectById: jest.fn(),
  findDuplicateProspects: jest.fn(),
  getModels: jest.fn(),
};

jest.mock('../growth-os.prospect.repository', () => mockRepository);
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));
jest.mock('../../audit/audit-log.entity', () => ({ create: mockAuditCreate }));

const {
  ALLOWED_TRANSITIONS,
  PROSPECT_STATUSES,
  assertTransition,
  canTransition,
} = require('../growth-os.prospect.lifecycle');
const prospectService = require('../growth-os.prospect.service');

const ALL_PROSPECT_ACCESS = {
  role: 'FOUNDER',
  permissions: ['growth_os.prospects.manage_all', 'growth_os.prospects.read_all'],
};

function makeProspect(overrides = {}) {
  const row = {
    id: 'prospect-1',
    business_name: 'North Star',
    contact_name: 'Owner',
    contact_phone: '01700000000',
    contact_email: 'owner@example.com',
    page_url: 'https://facebook.com/north-star',
    niche: 'retail',
    notes: null,
    normalized_business_name: 'north star',
    normalized_phone: '+8801700000000',
    normalized_email: 'owner@example.com',
    normalized_page: 'facebook.com/north-star',
    source: 'manual_entry',
    source_detail: null,
    source_reference: null,
    source_recorded_at: new Date('2026-08-20T00:00:00.000Z'),
    status: 'qualified',
    status_changed_at: new Date('2026-08-20T00:00:00.000Z'),
    disqualified_reason: null,
    owner_user_id: null,
    assigned_at: null,
    assigned_by: null,
    linked_shop_id: null,
    linked_user_id: null,
    linked_at: null,
    merged_into_id: null,
    merged_at: null,
    created_by: null,
    metadata: {},
    created_at: new Date('2026-08-20T00:00:00.000Z'),
    updated_at: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
  row.toJSON = () => {
    const { toJSON, update, ...values } = row;
    return values;
  };
  row.update = jest.fn(async (values) => {
    Object.assign(row, values);
    return row;
  });
  return row;
}

describe('Growth OS prospect lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSequelize.transaction.mockImplementation(async (work) => work(mockTransaction));
    mockEventCreate.mockResolvedValue({ id: 'event-1' });
    mockAuditCreate.mockResolvedValue({ id: 'audit-1' });
    mockRepository.getModels.mockReturnValue({
      GrowthOsProspectEvent: { create: mockEventCreate },
    });
    mockRepository.findDuplicateProspects.mockResolvedValue([]);
  });

  it('accepts every declared legal transition and rejects every other status pair', () => {
    for (const fromStatus of PROSPECT_STATUSES) {
      for (const toStatus of PROSPECT_STATUSES) {
        const legal = ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
        expect(canTransition(fromStatus, toStatus)).toBe(legal);
        if (legal) {
          expect(() => assertTransition(fromStatus, toStatus)).not.toThrow();
        } else {
          expect(() => assertTransition(fromStatus, toStatus)).toThrow(
            `Invalid prospect lifecycle transition: ${fromStatus} -> ${toStatus}`,
          );
        }
      }
    }

    expect(canTransition('missing', 'new')).toBe(false);
    expect(() => assertTransition('new', 'missing')).toThrow('Invalid prospect lifecycle transition');
  });

  it('keeps converted and merged statuses terminal', () => {
    expect(ALLOWED_TRANSITIONS.converted).toEqual([]);
    expect(ALLOWED_TRANSITIONS.merged).toEqual([]);
    expect(() => assertTransition('converted', 'qualified')).toThrow('Invalid prospect lifecycle transition');
    expect(() => assertTransition('merged', 'new')).toThrow('Invalid prospect lifecycle transition');
  });

  it('requires a linked shop at the service boundary before conversion', async () => {
    const row = makeProspect({ status: 'qualified', linked_shop_id: null });
    mockRepository.findProspectById.mockResolvedValue(row);

    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'converted',
      reason: 'Converted after verified shop linkage',
    })).rejects.toMatchObject({
      status: 400,
      code: 'GROWTH_OS_PROSPECT_INVALID_INPUT',
    });
    expect(row.update).not.toHaveBeenCalled();

    row.linked_shop_id = 'shop-1';
    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'converted',
      reason: 'Converted after verified shop linkage',
    })).resolves.toMatchObject({ status: 'converted', linkedShopId: 'shop-1' });
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'converted' }), {
      transaction: mockTransaction,
    });
  });

  it('requires a reason to disqualify and preserves it in the transition event', async () => {
    const row = makeProspect({ status: 'qualified' });
    mockRepository.findProspectById.mockResolvedValue(row);

    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'disqualified',
    })).rejects.toMatchObject({
      status: 400,
      code: 'GROWTH_OS_PROSPECT_INVALID_INPUT',
    });

    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'disqualified',
      reason: 'No longer operating',
    })).resolves.toMatchObject({
      status: 'disqualified',
      disqualifiedReason: 'No longer operating',
    });
    expect(mockEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'status_changed',
      reason: 'No longer operating',
      from_value: 'qualified',
      to_value: 'disqualified',
    }), { transaction: mockTransaction });
  });

  it('requires a reason to reopen a disqualified prospect and clears the old reason', async () => {
    const row = makeProspect({
      status: 'disqualified',
      disqualified_reason: 'No longer operating',
    });
    mockRepository.findProspectById.mockResolvedValue(row);

    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'qualifying',
    })).rejects.toMatchObject({
      status: 400,
      code: 'GROWTH_OS_PROSPECT_INVALID_INPUT',
    });

    await expect(prospectService.transition({
      userId: 'founder-1',
      access: ALL_PROSPECT_ACCESS,
      prospectId: row.id,
      status: 'qualifying',
      reason: 'Owner requested a fresh qualification call',
    })).resolves.toMatchObject({
      status: 'qualifying',
      disqualifiedReason: null,
    });
    expect(row.disqualified_reason).toBeNull();
  });

  it('derives next-phase eligibility only for qualified owned records with a channel', () => {
    const base = makeProspect({ status: 'qualified', owner_user_id: 'owner-1' });
    expect(prospectService.toApiProspect(base, { redacted: false }).eligibleForNextPhase).toBe(true);

    for (const overrides of [
      { status: 'new' },
      { owner_user_id: null },
      { normalized_phone: null, normalized_email: null, normalized_page: null },
      { status: 'merged', merged_into_id: 'target-1' },
    ]) {
      expect(prospectService.toApiProspect(makeProspect({ ...base, ...overrides }), { redacted: false })
        .eligibleForNextPhase).toBe(false);
    }
  });
});
