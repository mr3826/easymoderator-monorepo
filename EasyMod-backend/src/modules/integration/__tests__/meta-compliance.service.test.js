'use strict';

const mockModels = {
    AuditLog: { create: jest.fn(), findAll: jest.fn() },
    Conversation: { findAll: jest.fn(), destroy: jest.fn() },
    Customer: { findOne: jest.fn(), destroy: jest.fn() },
    CustomerDeliveryStats: { destroy: jest.fn() },
    CustomerPreference: { destroy: jest.fn() },
    DeliveryTracking: { findAll: jest.fn() },
    Message: { findAll: jest.fn() },
    MetaDataDeletionRequest: {
        findOrCreate: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
    },
    MetaUserIdentity: { findAll: jest.fn(), destroy: jest.fn() },
    Order: { findAll: jest.fn(), update: jest.fn() },
    OrderInvoice: { findAll: jest.fn() },
    OrderReturn: { destroy: jest.fn() },
    OwnerNotification: { findAll: jest.fn() },
    PaymentTransaction: { update: jest.fn() },
    SupportTicket: { destroy: jest.fn() },
    TrxIDLog: { update: jest.fn() },
};
const mockOrderSession = { destroy: jest.fn() };
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSequelize = {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
    query: jest.fn(),
};
const mockConsent = {
    recordDataDeletion: jest.fn(),
};
const mockOpsAlert = jest.fn();
const mockUnlink = jest.fn();

jest.mock('../../entities', () => mockModels);
jest.mock('../../order/order-session.entity', () => mockOrderSession);
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
        processing_token: null,
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
        mockModels.AuditLog.findAll.mockResolvedValue([]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([]);
        mockModels.MetaUserIdentity.destroy.mockResolvedValue(0);
        mockModels.MetaDataDeletionRequest.update.mockResolvedValue([1]);
        mockModels.OwnerNotification.findAll.mockResolvedValue([]);
        mockModels.OrderInvoice.findAll.mockResolvedValue([]);
        mockModels.DeliveryTracking.findAll.mockResolvedValue([]);
        mockModels.CustomerDeliveryStats.destroy.mockResolvedValue(0);
        mockModels.CustomerPreference.destroy.mockResolvedValue(0);
        mockModels.OrderReturn.destroy.mockResolvedValue(0);
        mockModels.SupportTicket.destroy.mockResolvedValue(0);
        mockModels.Conversation.destroy.mockResolvedValue(0);
        mockModels.Customer.destroy.mockResolvedValue(0);
        mockModels.Order.update.mockResolvedValue([0]);
        mockModels.PaymentTransaction.update.mockResolvedValue([0]);
        mockModels.TrxIDLog.update.mockResolvedValue([0]);
        mockOrderSession.destroy.mockResolvedValue(0);
        mockSequelize.query.mockResolvedValue([[], {}]);
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
        expect(mockModels.MetaDataDeletionRequest.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'PROCESSING' }),
            expect.objectContaining({
                where: expect.objectContaining({
                    id: request.id,
                }),
            }),
        );
        expect(mockModels.Customer.destroy).not.toHaveBeenCalled();
    });

    test('a mapping without a Page-scoped identity remains unresolved with zero counters', async () => {
        const request = deletionRequest();
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, true]);
        mockModels.MetaUserIdentity.findAll.mockResolvedValue([{
            channel_id: 'channel-1',
            shop_id: 'shop-1',
            page_scoped_user_id: null,
        }]);

        const result = await service.processDeletionRequest({
            signedRequest: 'signed-null-psid',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        });

        expect(result.request).toMatchObject({
            status: 'IDENTITY_NOT_RESOLVED',
            matched_customer_count: 0,
            conversations_deleted_count: 0,
            messages_deleted_count: 0,
            orders_anonymized_count: 0,
        });
        expect(mockModels.Customer.findOne).not.toHaveBeenCalled();
        expect(mockModels.MetaUserIdentity.destroy).not.toHaveBeenCalled();
        expect(mockConsent.recordDataDeletion).not.toHaveBeenCalled();
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
        const invoice = {
            pdf_url: 'https://easymod.tech/uploads/invoices/shop-1/order-1.pdf',
            order_data: {
                order_number: 'ORD-1',
                total: 1200,
                customer_name: 'Synthetic Customer',
                delivery_address: 'Synthetic Address',
            },
            update: jest.fn().mockResolvedValue(undefined),
        };
        const tracking = {
            id: 'tracking-1',
            status_history: [{
                status: 'in_transit',
                timestamp: '2026-07-23T00:00:00.000Z',
                location: 'Synthetic Address',
            }],
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockModels.OrderInvoice.findAll.mockResolvedValue([invoice]);
        mockModels.DeliveryTracking.findAll.mockResolvedValue([tracking]);

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
                delivery_consignment_id: null,
                delivery_tracking_code: null,
                note: null,
                notes: null,
                idempotency_key: null,
            }),
            expect.objectContaining({
                where: { shop_id: 'shop-1', customer_id: 'customer-1' },
            }),
        );
        expect(mockModels.Conversation.destroy).toHaveBeenCalled();
        expect(mockOrderSession.destroy).toHaveBeenCalled();
        expect(mockModels.OrderReturn.destroy).toHaveBeenCalled();
        expect(mockModels.SupportTicket.destroy).toHaveBeenCalled();
        expect(mockModels.PaymentTransaction.update).toHaveBeenCalledWith(
            { gateway_response: null },
            expect.anything(),
        );
        expect(mockModels.TrxIDLog.update).toHaveBeenCalledWith(
            { sender_phone: null, ocr_raw: null },
            expect.anything(),
        );
        expect(invoice.update).toHaveBeenCalledWith(expect.objectContaining({
            pdf_url: null,
            customer_info: null,
            delivery_info: null,
            order_data: {
                customerDeleted: true,
                order_number: 'ORD-1',
                total: 1200,
            },
        }), expect.anything());
        expect(tracking.update).toHaveBeenCalledWith(expect.objectContaining({
            tracking_number: 'deleted-tracking-1',
            location_info: null,
            delivery_agent_info: null,
            status_history: [{
                status: 'in_transit',
                timestamp: '2026-07-23T00:00:00.000Z',
            }],
        }), expect.anything());
        expect(mockSequelize.query).toHaveBeenCalledWith(
            expect.stringContaining('SET courier_data = NULL'),
            expect.objectContaining({
                replacements: {
                    shopId: 'shop-1',
                    orderIds: ['order-1', 'order-2'],
                },
            }),
        );
        expect(mockModels.Customer.destroy).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'customer-1', shop_id: 'shop-1' },
        }));
        expect(mockUnlink).toHaveBeenCalledTimes(2);
        expect(result.request).toMatchObject({
            status: 'COMPLETED',
            matched_customer_count: 1,
            conversations_deleted_count: 1,
            messages_deleted_count: 1,
            orders_anonymized_count: 2,
            attachments_deleted_count: 2,
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
        expect(mockSequelize.transaction).toHaveBeenCalledTimes(1);
        expect(mockModels.MetaUserIdentity.destroy).not.toHaveBeenCalled();
    });

    test('a superseded stale worker cannot commit counters, status, or audit events', async () => {
        const request = deletionRequest({
            status: 'PROCESSING',
            started_at: new Date(Date.now() - 20 * 60 * 1000),
        });
        mockModels.MetaDataDeletionRequest.findOrCreate.mockResolvedValue([request, false]);
        mockModels.MetaDataDeletionRequest.update
            .mockResolvedValueOnce([1])
            .mockResolvedValueOnce([0]);

        await expect(service.processDeletionRequest({
            signedRequest: 'signed-stale-fenced',
            appScopedUserId: 'app-user-1',
            appSecret: 'secret',
        })).rejects.toMatchObject({ code: 'DELETION_CLAIM_LOST' });

        expect(mockModels.AuditLog.create).not.toHaveBeenCalledWith(
            expect.objectContaining({
                action: expect.stringMatching(/^meta_deletion_(completed|failed)$/),
            }),
            expect.anything(),
        );
        expect(mockConsent.recordDataDeletion).not.toHaveBeenCalled();
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
