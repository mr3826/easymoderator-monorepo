'use strict';

jest.mock('../audit-log.entity', () => ({
  create: jest.fn(),
  findAll: jest.fn(),
}));
jest.mock('../idempotency-key.entity', () => ({
  findOrCreate: jest.fn(),
  findOne: jest.fn(),
  cleanupExpired: jest.fn(),
}));

const AuditLog = require('../audit-log.entity');
const AuditService = require('../audit.service');

function auditRow() {
  return {
    get: () => ({
      id: 'audit-1',
      user_id: 'user-1',
      shop_id: 'shop-1',
      action: 'admin:change_plan',
      resource_type: 'SUBSCRIPTION',
      resource_id: 'shop-1',
      old_values: { token: 'must-not-leak' },
      new_values: { page_url: 'https://example.com/shop?secret=must-not-leak' },
      metadata: { private_note: 'must-not-leak' },
      created_at: new Date('2026-09-15T00:00:00.000Z'),
      user: { id: 'user-1', full_name: 'Operator', email: 'operator@example.com' },
    }),
  };
}

describe('shared audit reader safety', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a tenant-safe summary without audit blobs or user email', async () => {
    AuditLog.findAll.mockResolvedValue([auditRow()]);

    const result = await AuditService.getShopAuditLogs('shop-1');

    expect(result).toEqual([{
      id: 'audit-1',
      user_id: 'user-1',
      shop_id: 'shop-1',
      action: 'admin:change_plan',
      resource_type: 'SUBSCRIPTION',
      resource_id: 'shop-1',
      created_at: new Date('2026-09-15T00:00:00.000Z'),
      user: { id: 'user-1', full_name: 'Operator' },
    }]);
    expect(result[0]).not.toHaveProperty('old_values');
    expect(result[0]).not.toHaveProperty('new_values');
    expect(AuditLog.findAll.mock.calls[0][0].include[0].attributes).toEqual(['id', 'full_name']);
  });

  it('sanitizes sensitive values before storing an audit row', async () => {
    AuditLog.create.mockResolvedValue({});

    await AuditService.logOperation({
      userId: 'user-1',
      shopId: 'shop-1',
      action: 'admin:test',
      resourceType: 'SHOP',
      resourceId: 'shop-1',
      oldValues: { authorization: 'Bearer token' },
      newValues: { page_url: 'https://example.com/path?token=secret#fragment' },
      metadata: { password: 'secret' },
    });

    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      old_values: { authorization: '[redacted]' },
      new_values: { page_url: 'https://example.com/path' },
      metadata: { password: '[redacted]' },
    }));
  });
});
