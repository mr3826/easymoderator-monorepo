'use strict';

const { Op } = require('sequelize');

const mockProspect = { findAll: jest.fn() };

jest.mock('../../entities', () => ({
  GrowthOsProspect: mockProspect,
}));
jest.mock('../growth-os.prospect.scope', () => ({
  resolveProspectScope: jest.fn(),
}));

const { globalSearch } = require('../growth-os.workspace.service');
const { resolveProspectScope } = require('../growth-os.prospect.scope');

describe('Growth workspace search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveProspectScope.mockReturnValue({
      kind: 'source',
      where: { source: { [Op.in]: ['facebook'] } },
      redacted: true,
    });
    mockProspect.findAll.mockResolvedValue([{
      id: 'prospect-1',
      business_name: 'Cafe au lait',
      status: 'new',
      source: 'facebook',
      owner_user_id: 'private-owner-id',
      contact_name: 'Private Owner',
      contact_phone: '01700000000',
      contact_email: 'private@example.test',
    }]);
  });

  test('redacts owner identity and preserves Unicode normalized-name search', async () => {
    const result = await globalSearch({
      access: { permissions: ['growth_os.search.read'] },
      userId: 'source-reader',
      query: 'Café-au_lait',
      isSuperAdmin: false,
    });

    expect(result.prospects[0]).toMatchObject({
      prospectId: 'prospect-1',
      ownerUserId: null,
    });
    expect(JSON.stringify(result.prospects)).not.toContain('private-owner-id');

    const predicates = mockProspect.findAll.mock.calls[0][0].where[Op.or];
    const normalizedPredicate = predicates.find((predicate) => (
      Object.prototype.hasOwnProperty.call(predicate, 'normalized_business_name')
    ));
    expect(normalizedPredicate.normalized_business_name[Op.iLike]).toBe('%café au lait%');
  });
});
