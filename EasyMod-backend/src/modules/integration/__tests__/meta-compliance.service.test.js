'use strict';

const mockModels = {
    AuditLog: { create: jest.fn() },
    Conversation: { findAll: jest.fn(), destroy: jest.fn() },
    Customer: { findOne: jest.fn(), destroy: jest.fn() },
    CustomerDeliveryStats: { destroy: jest.fn() },
    CustomerPreference: { destroy: jest.fn() },
    Message: { findAll: jest.fn() },
    MetaDataDeletionRequest: {
        findOrCreate: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
    },
    MetaUserIdentity: { findAll: jest.fn(), destroy: jest.fn() },
    Order: { findAll: jest.fn(), update: jest.fn() },
    OwnerNotification: { findAll: jest.fn() },
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSequelize = {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
};
const mockConsent = {
    recordDataDeletion: jest.fn(),
};
const mockOpsAlert = jest.fn();
const mockUnlink = jest.fn();

jest.mock('../../entities', () => mockModels);
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));
jest.mock('../../consent/consent.service', () => mockConsent);
jest.mock('../../../utils/ops-alert', () => ({ opsAlert: mockOpsAlert }));
jest.mock('fs/promises', () => ({ unlink: mockUnlink }));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const service = require('../meta-compliance.service');

function deletionRequest(overrides = {}) {
    const row = {
        id: 'request-1',
        status: 'PENDING',
        matched_customer_count: 0,
        conversations_deleted_count: 0,
        messages_deleted_count: 0,
        orders_anonymized_count: 0,
        attachments_deleted_count: 0,
        pending_attachment_paths: [],
        data_phase_completed_at: null,
        update: jest.fn(async (values) => Object.assign(row, values)),
        reload: jest.fn(async () => row),
        ...overrides,
    };
    return row;
}

describe('Meta compliance deletion transaction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockModels.AuditLog.create.mockResolvedValue({});
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([]);
        mockModels.MetaUserIdentity.destroy.mockResolvedValue(0);
        mockModels.MetaDataDeletionRequest.update.mockResolvedValue([1]);
        mockModels.OwnerNotification.findAll.mockResolvedValue([]);
        mockModels.CustomerDeliveryStats.destroy.mockResolvedValue(0);
        mockModels.CustomerPreference.destroy.mockResolvedValue(0);
        mockModels.Conversation.destroy.mockResolvedValue(0);
        mockModels.Customer.destroy.mockResolvedValue(0);
        mockModels.Order.update.mockResolvedValue([0]);
        mockUnlink.mockResolvedValue(undefined);
        mockConsent.recordDataDeletion.mockResolvedValue({});
    });

    test('unmapped identity remains durable and retryable without false completion', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed',
            appScopedUserId: 'unknown',
            appSecret: 'secret',
        });

        expect(result.request.status).toBe('IDENTITY_NOT_RESOLVED');
        expect(result.request.matched_customer_count).toBe(0);
        expect(mockModels.Customer.destroy).not.toHaveBeenCalled();
        expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'meta_deletion_identity_not_resolved' }),
            expect.anything(),
        );
        expect(mockModels.AuditLog.create).not.toHaveBeenCalledWith(
            expect.objectContaining({
                action: expect.stringMatching(
                    /^meta_deletion_(identity_resolved|completed|shop_data_removed)$/,
                ),
            }),
            expect.anything(),
        );
        expect(mockConsent.recordDataDeletion).not.toHaveBeenCalled();
        expect(mockOpsAlert).toHaveBeenCalledWith(
            'Meta deletion identity not resolved',
            expect.objectContaining({
                context: { requestId: request.id },
            }),
        );
        expect(service.serializeDeletionStatus(result.request)).toMatchObject({
            status: 'identity_not_resolved',
            retryable: true,
            matched_customers: 0,
        });
    });

    test('legitimately resolved identity with no retained customer data completes as no-data', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([{
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: 'psid-1',
        }]);
        mockModels.Customer.findOne.mockResolvedValue(null);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed-resolved-no-data',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(result.request).toMatchObject({
            status: 'COMPLETED',
            matched_customer_count: 0,
        });
        expect(mockModels.MetaUserIdentity.destroy).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { app_scoped_user_id: 'app-user-1' },
            }),
        );
        expect(mockConsent.recordDataDeletion).not.toHaveBeenCalled();
        expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'meta_deletion_identity_resolved' }),
            expect.anything(),
        );
        expect(mockModels.AuditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'meta_deletion_completed' }),
            expect.anything(),
        );
        expect(mockOpsAlert).not.toHaveBeenCalled();
    });

    test('an unresolved request retries after a legitimate mapping becomes available', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate
            .mockResolvedValueOnce([request, true])
            .mockResolvedValueOnce([request, false]);

        const first = await service.processDeletionRequest({
            signedRequest: 'signed-retryable',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });
        expect(first.request.status).toBe('IDENTITY_NOT_RESOLVED');

        const mapping = {
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: 'psid-1',
        };
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([mapping]);
        mockModels.Customer.findOne.mockResolvedValue(null);

        const second = await service.processDeletionRequest({
            signedRequest: 'signed-retryable',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(second.request.status).toBe('COMPLETED');
        expect(mockModels.MetaDataDeletionRequest.update).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'PROCESSING' }),
            expect.objectContaining({
                where: expect.objectContaining({
                    id: request.id,
                }),
            }),
        );
        expect(mockModels.Customer.destroy).not.toHaveBeenCalled();
    });

    test('deletes conversations/messages, handles attachments, and anonymizes order PII', async () => {
        const request = deletionRequest();
        const mapping = {
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: 'psid-1',
        };
        const customer = { id: 'customer-1', shop_id: 'shop-1', phone: '01700000000' };
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([mapping]);
        mockModels.Customer.findOne.mockResolvedValue(customer);
        mockModels.Conversation.findAll.mockResolvedValue([{ id: 'conversation-1' }]);
        mockModels.Message.findAll.mockResolvedValue([{
            id: 'message-1',
            metadata: {
                image_url: 'https://easymod.tech/uploads/conversation-attachments/shop-1/file.png',
            },
        }]);
        mockModels.Order.findAll.mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(mockModels.Customer.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                shop_id: 'shop-1',
                channel_user_id: 'psid-1',
            }),
        }));
        expect(mockConsent.recordDataDeletion).toHaveBeenCalledWith(expect.objectContaining({
            shopId: 'shop-1',
            channelId: 'channel-1',
            customerId: 'customer-1',
            strictAudit: true,
        }));
        expect(mockModels.Order.update).toHaveBeenCalledWith(
            expect.objectContaining({
                customer_id: null,
                customer_name: 'Deleted customer',
                customer_phone: null,
                delivery_address: null,
                delivery_area: null,
                delivery_location: null,
                delivery_zone: null,
                note: null,
                notes: null,
            }),
            expect.objectContaining({
                where: { shop_id: 'shop-1', customer_id: 'customer-1' },
            }),
        );
        expect(mockModels.Conversation.destroy).toHaveBeenCalled();
        expect(mockModels.Customer.destroy).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'customer-1', shop_id: 'shop-1' },
        }));
        expect(mockUnlink).toHaveBeenCalledTimes(1);
        expect(result.request).toMatchObject({
            status: 'COMPLETED',
            matched_customer_count: 1,
            conversations_deleted_count: 1,
            messages_deleted_count: 1,
            orders_anonymized_count: 2,
            attachments_deleted_count: 1,
        });
    });

    test('deletes a matched customer safely when no orders exist', async () => {
        const request = deletionRequest();
        const mapping = {
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: 'psid-1',
        };
        const customer = { id: 'customer-1', shop_id: 'shop-1' };
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([mapping]);
        mockModels.Customer.findOne.mockResolvedValue(customer);
        mockModels.Conversation.findAll.mockResolvedValue([]);
        mockModels.Message.findAll.mockResolvedValue([]);
        mockModels.Order.findAll.mockResolvedValue([]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed-no-orders',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(result.request).toMatchObject({
            status: 'COMPLETED',
            matched_customer_count: 1,
            orders_anonymized_count: 0,
        });
        expect(mockModels.Customer.destroy).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'customer-1', shop_id: 'shop-1' },
        }));
        expect(mockConsent.recordDataDeletion).toHaveBeenCalled();
    });

    test('resolved mapping never deletes a customer outside the mapped shop and Page identity', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([{
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: 'psid-1',
        }]);
        mockModels.Customer.findOne.mockResolvedValue(null);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed-cross-shop',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(mockModels.Customer.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                shop_id: 'shop-1',
                channel_type: 'messenger',
                channel_user_id: 'psid-1',
            },
        }));
        expect(result.request.matched_customer_count).toBe(0);
        expect(mockModels.Customer.destroy).not.toHaveBeenCalled();
        expect(mockModels.Order.update).not.toHaveBeenCalled();
    });

    test('repeated completed request is idempotent and does not run deletion again', async () => {
        const request = deletionRequest({ status: 'COMPLETED' });
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, false]);
        const result = await service.processDeletionRequest({
            signedRequest: 'signed',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });
        expect(result.repeated).toBe(true);
        expect(mockSequelize.transaction).not.toHaveBeenCalled();
    });

    test('a concurrent worker cannot claim and process the same request twice', async () => {
        const request = deletionRequest();
        request.reload.mockImplementation(async () => {
            request.status = 'PROCESSING';
            return request;
        });
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, false]);
        mockModels.MetaDataDeletionRequest.update.mockResolvedValue([0]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(result).toMatchObject({ pending: true, repeated: true });
        expect(mockModels.MetaDataDeletionRequest.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'PROCESSING' }),
            expect.objectContaining({
                where: expect.objectContaining({ id: 'request-1' }),
            }),
        );
        expect(mockSequelize.transaction).not.toHaveBeenCalled();
    });

    test('a stale worker resumes after the committed data phase without deleting twice', async () => {
        const request = deletionRequest({
            status: 'PROCESSING',
            started_at: new Date(Date.now() - 20 * 60 * 1000),
            data_phase_completed_at: new Date(Date.now() - 19 * 60 * 1000),
            matched_customer_count: 1,
            pending_attachment_paths: ['conversation-attachments/shop-1/file.png'],
        });
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, false]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed-stale-worker',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(result).toMatchObject({ repeated: true });
        expect(result.request.status).toBe('COMPLETED');
        expect(mockUnlink).toHaveBeenCalledTimes(1);
        expect(mockSequelize.transaction).not.toHaveBeenCalled();
        expect(mockModels.MetaUserIdentity.destroy).not.toHaveBeenCalled();
    });

    test('database failure marks the durable request failed and never returns success', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockRejectedValue(new Error('database unavailable'));

        await expect(service.processDeletionRequest({
            signedRequest: 'signed',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        })).rejects.toThrow('database unavailable');
        expect(request.status).toBe('FAILED');
        expect(request.failure_code).toBe('DELETION_PROCESSING_FAILED');
        expect(request.completed_at).toBeNull();
    });

    test('attachment policy ignores remote and traversal paths', () => {
        const paths = service._private.collectOwnedAttachmentPaths([
            { metadata: { image_url: 'https://attacker.invalid/private.png' } },
            { metadata: { file_url: '/uploads/conversation-attachments/../secret.txt' } },
            { metadata: { file_url: '/uploads/conversation-attachments/shop-1/safe.png' } },
        ]);
        expect(paths).toEqual(['conversation-attachments/shop-1/safe.png']);
    });
});
