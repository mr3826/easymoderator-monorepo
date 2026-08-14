'use strict';

const mockAuditLog = { findAll: jest.fn() };

jest.mock('../../modules/audit/audit-log.entity', () => mockAuditLog);
jest.mock('../../modules/audit/idempotency-key.entity', () => ({ cleanupExpired: jest.fn() }));
jest.mock('../../modules/user/user.entity', () => ({ name: 'User' }));

const AuditService = require('../../modules/audit/audit.service');

describe('resource audit-log tenant scope', () => {
    beforeEach(() => jest.clearAllMocks());

    it('requires and applies the verified shop scope', async () => {
        mockAuditLog.findAll.mockResolvedValue([]);

        await AuditService.getAuditLogs('ORDER', 'order-1', { shopId: 'shop-1' });

        expect(mockAuditLog.findAll).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                shop_id: 'shop-1',
                resource_type: 'ORDER',
                resource_id: 'order-1',
            },
        }));
    });

    it('rejects an unscoped resource lookup', async () => {
        await expect(AuditService.getAuditLogs('ORDER', 'order-1')).rejects.toMatchObject({
            status: 400,
        });
        expect(mockAuditLog.findAll).not.toHaveBeenCalled();
    });
});
