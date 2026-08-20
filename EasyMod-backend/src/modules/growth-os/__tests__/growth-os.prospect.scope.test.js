'use strict';

const { Op } = require('sequelize');
const {
  canRead,
  resolveProspectScope,
} = require('../growth-os.prospect.scope');

describe('Growth OS prospect scope contract', () => {
  it('allows a read-assigned permission to read without granting mutation rights', () => {
    const access = { permissions: ['growth_os.prospects.read_assigned'] };
    const scope = resolveProspectScope(access, 'owner-1');

    expect(canRead(access)).toBe(true);
    expect(scope).toMatchObject({
      kind: 'assigned',
      where: { owner_user_id: 'owner-1' },
      canEdit: false,
      canChangeStatus: false,
    });
  });

  it('limits source scope to marketing-attributable sources', () => {
    const scope = resolveProspectScope({
      permissions: ['growth_os.prospects.read_source_scope'],
    }, 'marketer-1');
    const sourceClause = scope.where.source;

    expect(scope.kind).toBe('source');
    expect(sourceClause[Op.in]).toEqual([
      'self_signup',
      'partner_form',
      'referral_mention',
      'inbound_message',
      'event',
    ]);
  });
});
