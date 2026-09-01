'use strict';

process.env.NODE_ENV = 'test';

const mockScheduleBurstFlush = jest.fn();
const mockCancelBurstFlush = jest.fn();
let mockMessageQueue = { add: jest.fn() };

jest.mock('../../../jobs/message-queue', () => ({
    get messageQueue() { return mockMessageQueue; },
}));
jest.mock('src/jobs/burst-coalescer', () => ({
    scheduleBurstFlush: (...args) => mockScheduleBurstFlush(...args),
    cancelBurstFlush: (...args) => mockCancelBurstFlush(...args),
}));

const mockCustomer = { findOrCreate: jest.fn() };
const mockConversation = { findOne: jest.fn(), create: jest.fn() };
const mockMessage = { findOne: jest.fn(), create: jest.fn() };
jest.mock('src/modules/entities', () => ({
    Customer: mockCustomer,
    AuditLog: { create: jest.fn() },
}));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: mockConversation,
    Message: mockMessage,
}));

const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (fn) => fn(mockTransaction)),
    },
}));

const mockIsStopKeyword = jest.fn();
const mockRecordInbound = jest.fn();
const mockRecordOptOut = jest.fn();
const mockRecordOptIn = jest.fn();
jest.mock('src/modules/consent/consent.service', () => ({
    isStopKeyword: (...args) => mockIsStopKeyword(...args),
    recordInbound: (...args) => mockRecordInbound(...args),
    recordOptOut: (...args) => mockRecordOptOut(...args),
    recordOptIn: (...args) => mockRecordOptIn(...args),
}));

jest.mock('src/modules/customer/customer-profile.service', () => ({
    enrichCustomerNameFromMeta: jest.fn(),
    isPlaceholderName: jest.fn(() => false),
}));
jest.mock('src/modules/subscription/subscription.service', () => ({
    trackUsage: jest.fn(async () => ({ within_allowance: true })),
}));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/utils/ops-alert', () => ({ opsAlert: jest.fn(async () => {}) }));
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const mockReceiptService = {
    markProcessing: jest.fn(),
    markProcessed: jest.fn(),
    markQueued: jest.fn(),
    markStoreFailure: jest.fn(),
    markIdentityNotResolved: jest.fn(),
};
jest.mock('src/modules/integration/meta-webhook-receipt.service', () => mockReceiptService);

const handler = require('src/modules/integration/meta-webhook-events.handler');
const { Message } = require('src/modules/conversation/conversation.entity');

const SHOP_ID = 'shop-1';
const PAGE_ID = 'page-1';
const CHANNEL_ID = 'channel-1';
const CONVERSATION_ID = 'conversation-1';
const CUSTOMER_ID = 'customer-1';

const channel = {
    id: CHANNEL_ID,
    shop_id: SHOP_ID,
    platform: 'facebook',
    meta_asset_id: PAGE_ID,
    status: 'CONNECTED',
};

const messaging = {
    sender: { id: 'psid-1' },
    recipient: { id: PAGE_ID },
    timestamp: Date.now(),
    message: { mid: 'mid-1', text: 'Hello' },
};

const receipt = { id: 'receipt-1', status: 'RECEIVED' };

beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleBurstFlush.mockReset().mockResolvedValue(undefined);
    mockCancelBurstFlush.mockReset().mockResolvedValue(undefined);
    mockIsStopKeyword.mockReturnValue(false);
    mockRecordInbound.mockResolvedValue({ id: CUSTOMER_ID });
    mockRecordOptOut.mockResolvedValue({ id: CUSTOMER_ID });
    mockRecordOptIn.mockResolvedValue({ id: CUSTOMER_ID });
    mockReceiptService.markProcessing.mockResolvedValue(undefined);
    mockReceiptService.markProcessed.mockResolvedValue(undefined);
    mockReceiptService.markQueued.mockImplementation(async (row) => {
        row.status = 'QUEUED';
    });
    mockReceiptService.markStoreFailure.mockResolvedValue(undefined);
    mockMessage.findOne.mockResolvedValue(null);
    mockCustomer.findOrCreate.mockResolvedValue([{
        id: CUSTOMER_ID,
        name: 'Known Customer',
        metadata: { first_name: 'Known', last_name: 'Customer', profile_pic: 'stored' },
    }, true]);
    mockConversation.findOne.mockResolvedValue(null);
    mockConversation.create.mockResolvedValue({
        id: CONVERSATION_ID,
        metadata: {},
        update: jest.fn().mockResolvedValue(undefined),
    });
    mockMessage.create.mockResolvedValue({
        id: 'message-1',
        conversation_id: CONVERSATION_ID,
        metadata: {},
        toJSON: () => ({ id: 'message-1', metadata: {} }),
    });
});

const runProcess = () => handler.processMessagingEvent({
    messaging,
    channel,
    receipt,
    pageId: PAGE_ID,
    metaAssetId: PAGE_ID,
});

describe('dispatch queue availability', () => {
    test('propagates a missing queue error instead of resolving success', async () => {
        const dispatchMessageJob = handler._private.dispatchMessageJob;
        const previousQueue = mockMessageQueue;
        mockMessageQueue = null;

        try {
            await expect(dispatchMessageJob(
                { conversation_id: CONVERSATION_ID, customer_id: CUSTOMER_ID, message_id: 'message-1' },
                { shop_id: SHOP_ID, platform: 'facebook', sender: 'psid-1', meta_channel_id: CHANNEL_ID, metaAssetId: PAGE_ID },
            )).rejects.toMatchObject({
                name: 'QueueDispatchError',
                code: 'MESSAGE_QUEUE_UNAVAILABLE',
                retryable: true,
            });
        } finally {
            mockMessageQueue = previousQueue;
        }
    });
});

describe('shared inbound consent and dispatch boundary', () => {
    test('does not dispatch when consent bookkeeping fails', async () => {
        mockRecordInbound.mockRejectedValueOnce(new Error('consent store unavailable'));

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
        expect(mockCancelBurstFlush).not.toHaveBeenCalled();
        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({ message: 'consent store unavailable' }),
            expect.objectContaining({ pageId: PAGE_ID }),
        );
    });

    test('does not dispatch when STOP consent bookkeeping fails', async () => {
        mockIsStopKeyword.mockReturnValueOnce(true);
        mockRecordOptOut.mockRejectedValueOnce(new Error('consent store unavailable'));

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
        expect(mockCancelBurstFlush).not.toHaveBeenCalled();
        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalled();
    });

    test('does not dispatch when consent bookkeeping returns no state', async () => {
        mockRecordInbound.mockResolvedValueOnce(null);

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({ code: 'CONSENT_STATE_UNAVAILABLE', retryable: true }),
            expect.any(Object),
        );
    });

    test('does not dispatch when consent bookkeeping returns an incomplete state', async () => {
        mockRecordInbound.mockResolvedValueOnce({});

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({ code: 'CONSENT_STATE_UNAVAILABLE', retryable: true }),
            expect.any(Object),
        );
    });

    test('keeps a messaging opt-in retryable when consent state is missing', async () => {
        mockRecordOptIn.mockResolvedValueOnce(null);

        await expect(handler.processMessagingEvent({
            messaging: { ...messaging, optin: { ref: 'campaign-1' } },
            channel,
            receipt,
            pageId: PAGE_ID,
            metaAssetId: PAGE_ID,
        })).resolves.toBe('failed');

        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({ code: 'CONSENT_STATE_UNAVAILABLE', retryable: true }),
            expect.any(Object),
        );
    });

    test('awaits dispatch and records a retryable store failure when queue scheduling rejects', async () => {
        const dispatchError = new Error('queue write failed');
        mockScheduleBurstFlush.mockRejectedValueOnce(dispatchError);

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({
                name: 'QUEUE_DISPATCH_FAILED',
                code: 'QUEUE_DISPATCH_FAILED',
                retryable: true,
                cause: dispatchError,
            }),
            expect.objectContaining({ pageId: PAGE_ID }),
        );
    });

    test('does not settle the receipt when the queue returns a non-runnable handoff', async () => {
        const nonRunnableError = Object.assign(
            new Error('Burst flush enqueue did not produce a runnable job'),
            { code: 'QUEUE_JOB_NOT_RUNNABLE', retryable: true },
        );
        mockScheduleBurstFlush.mockRejectedValueOnce(nonRunnableError);

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({
                name: 'QUEUE_DISPATCH_FAILED',
                code: 'QUEUE_DISPATCH_FAILED',
                retryable: true,
                cause: nonRunnableError,
            }),
            expect.objectContaining({ pageId: PAGE_ID }),
        );
    });

    test('does not report QUEUED when the receipt update did not take effect', async () => {
        mockReceiptService.markQueued.mockImplementationOnce(async () => {});

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({
                name: 'QUEUE_RECEIPT_UPDATE_FAILED',
                code: 'QUEUE_RECEIPT_UPDATE_FAILED',
                retryable: true,
            }),
            expect.objectContaining({ pageId: PAGE_ID }),
        );
    });

    test('waits for STOP burst cancellation before marking the receipt successful', async () => {
        mockIsStopKeyword.mockReturnValueOnce(true);
        let releaseCancellation;
        mockCancelBurstFlush.mockImplementationOnce(() => new Promise((resolve) => {
            releaseCancellation = resolve;
        }));

        const processing = runProcess();
        await new Promise((resolve) => setImmediate(resolve));

        expect(releaseCancellation).toEqual(expect.any(Function));
        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();

        releaseCancellation();
        await expect(processing).resolves.toBe('processed');
        expect(mockCancelBurstFlush).toHaveBeenCalledWith(CONVERSATION_ID, { strict: true });
        expect(mockReceiptService.markProcessed).toHaveBeenCalledWith(receipt, {
            shopId: SHOP_ID,
            metaChannelId: CHANNEL_ID,
        });
    });

    test('keeps a STOP event retryable when burst cancellation fails', async () => {
        mockIsStopKeyword.mockReturnValueOnce(true);
        const cancellationError = new Error('burst cancellation unavailable');
        mockCancelBurstFlush.mockRejectedValueOnce(cancellationError);

        await expect(runProcess()).resolves.toBe('failed');

        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
        expect(mockReceiptService.markQueued).not.toHaveBeenCalled();
        expect(mockReceiptService.markStoreFailure).toHaveBeenCalledWith(
            receipt,
            expect.objectContaining({
                name: 'BURST_CANCELLATION_FAILED',
                code: 'BURST_CANCELLATION_FAILED',
                retryable: true,
                cause: cancellationError,
            }),
            expect.objectContaining({ pageId: PAGE_ID }),
        );
    });

    test('retains the exact Meta Page asset in the awaited burst dispatch payload', async () => {
        await expect(runProcess()).resolves.toBe('processed');

        expect(mockScheduleBurstFlush).toHaveBeenCalledWith(expect.objectContaining({
            metaChannelId: CHANNEL_ID,
            metaAssetId: PAGE_ID,
        }));
        expect(mockReceiptService.markQueued).toHaveBeenCalledWith(receipt, {
            shopId: SHOP_ID,
            metaChannelId: CHANNEL_ID,
        });
        expect(mockReceiptService.markProcessed).not.toHaveBeenCalled();
    });
});

describe('dispatchMessageJob error propagation', () => {
    test('propagates a queue scheduling error to the caller instead of resolving success', async () => {
        const dispatchMessageJob = handler._private.dispatchMessageJob;
        const dispatchError = new Error('queue write failed');
        mockScheduleBurstFlush.mockRejectedValueOnce(dispatchError);

        await expect(dispatchMessageJob(
            { conversation_id: CONVERSATION_ID, customer_id: CUSTOMER_ID, message_id: 'message-1' },
            { shop_id: SHOP_ID, platform: 'facebook', sender: 'psid-1', meta_channel_id: CHANNEL_ID, metaAssetId: PAGE_ID },
        )).rejects.toMatchObject({
            name: 'QueueDispatchError',
            code: 'QUEUE_DISPATCH_FAILED',
            retryable: true,
            cause: dispatchError,
        });
    });

    test('returns the durable queue handoff result', async () => {
        const dispatchMessageJob = handler._private.dispatchMessageJob;
        mockScheduleBurstFlush.mockResolvedValueOnce({ id: 'queued-job-1' });

        await expect(dispatchMessageJob(
            { conversation_id: CONVERSATION_ID, customer_id: CUSTOMER_ID, message_id: 'message-1' },
            { shop_id: SHOP_ID, platform: 'facebook', sender: 'psid-1', meta_channel_id: CHANNEL_ID, metaAssetId: PAGE_ID },
        )).resolves.toEqual({ id: 'queued-job-1' });
    });
});

describe('handler source async boundary', () => {
    test('awaits the dispatch call before settling the receipt', () => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(path.resolve(__dirname, '../meta-webhook-events.handler.js'), 'utf8');
        const dispatchIndex = source.indexOf('await dispatchMessageJob');
        const queuedIndex = source.indexOf('await markQueuedReceipt', dispatchIndex);

        expect(dispatchIndex).toBeGreaterThan(-1);
        expect(queuedIndex).toBeGreaterThan(dispatchIndex);
        expect(source.indexOf('await receiptService.markQueued')).toBeGreaterThan(-1);
    });
});
