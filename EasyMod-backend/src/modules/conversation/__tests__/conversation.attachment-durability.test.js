'use strict';

const fs = require('fs/promises');
const path = require('path');

const mockSseManager = { emit: jest.fn() };

process.env.NODE_ENV = 'test';
process.env.CSRF_SECRET = 'attachment-test-secret';
process.env.SESSION_SECRET = 'attachment-test-session-secret';
process.env.PUBLIC_BASE_URL = 'https://assets.test.invalid';
process.env.EASYMOD_UPLOAD_ROOT = path.resolve(__dirname, '../../../../.attachment-test-uploads');

jest.mock('../../entities', () => ({
    Conversation: {
        findOne: jest.fn(),
        findAndCountAll: jest.fn(),
    },
    Message: {
        findOne: jest.fn(),
        findAndCountAll: jest.fn(),
        findAll: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
    },
    Customer: {},
    MetaChannel: {},
    MetaChannelSettings: {},
    InboxDeliveryOutbox: {},
    AuditLog: {},
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        getDialect: () => 'sqlite',
        transaction: jest.fn(),
    },
}));
jest.mock('../../../config/redis', () => ({ cacheRedis: null }));
jest.mock('../../../utils/cache.service', () => ({}));
jest.mock('../../../utils/sse-manager', () => mockSseManager);
jest.mock('../../channel-providers/meta-channel.service', () => ({}));
jest.mock('../../channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('../conversation-lock.service', () => ({}));
jest.mock('../../policy/policy.engine', () => ({}));

const {
    ATTACHMENT_ROOT,
    absolutePathForKey,
    attachmentExists,
    buildStorageKey,
    mintAttachmentUrl,
    parseStorageKey,
    recoverStorageKeyFromLegacyUrl,
} = require('../attachment-storage');
const controller = require('../conversation.controller');
const conversationService = require('../conversation.service');
const { Conversation, Message } = require('../../entities');

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SHOP_ID = 'shop-1';
const storageKey = 'shop-1/historical.png';

function request() {
    return { protocol: 'https', get: () => 'assets.test.invalid' };
}

function response() {
    const res = {
        status: jest.fn(),
        end: jest.fn(),
        sendFile: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
}

async function prepareUpload() {
    return controller._private.prepareOutboundAttachmentMetadata(request(), SHOP_ID, {
        content: 'photo.png',
        sender: 'agent',
        message_type: 'image',
        metadata: {
            message_type: 'image',
            file_name: 'photo.png',
            file_data_url: PNG_DATA_URL,
        },
    });
}

describe('conversation attachment durability', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-08T18:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await fs.rm(path.dirname(ATTACHMENT_ROOT), { recursive: true, force: true });
    });

    test('new uploads persist a tenant-bound durable key and a signed URL', async () => {
        const prepared = await prepareUpload();
        const metadata = prepared.metadata;

        expect(metadata).toEqual(expect.objectContaining({
            attachment_source: 'inbox_upload',
            attachment_storage_key: expect.stringMatching(/^shop-1\/\d+-[0-9a-f-]{36}\.png$/),
            attachment_available: true,
            image_url: expect.stringContaining('signature='),
        }));
        expect(metadata.file_data_url).toBeUndefined();
        expect(await attachmentExists(metadata.attachment_storage_key)).toBe(true);
        expect(new URL(metadata.image_url).pathname).toContain('/uploads/conversation-attachments/shop-1/');
    });

    test('serves a valid signed file, rejects expiry, and allows a later re-sign', async () => {
        const absolutePath = absolutePathForKey(storageKey);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, Buffer.from('attachment bytes'));
        const freshUrl = mintAttachmentUrl({
            shopId: SHOP_ID,
            fileName: 'historical.png',
            baseUrl: 'https://assets.test.invalid',
        });
        const freshParsed = new URL(freshUrl);
        const freshResponse = response();
        await controller.serveConversationAttachment({
            params: { shopId: SHOP_ID, fileName: 'historical.png' },
            query: Object.fromEntries(freshParsed.searchParams.entries()),
        }, freshResponse, jest.fn());
        expect(freshResponse.sendFile).toHaveBeenCalledWith(absolutePath, { dotfiles: 'deny' }, expect.any(Function));

        const expiredResponse = response();
        await controller.serveConversationAttachment({
            params: { shopId: SHOP_ID, fileName: 'historical.png' },
            query: { expires: '1', signature: freshParsed.searchParams.get('signature') },
        }, expiredResponse, jest.fn());
        expect(expiredResponse.status).toHaveBeenCalledWith(404);
        expect(expiredResponse.end).toHaveBeenCalled();
    });

    test('reads re-sign from durable identity even when stored URLs are stale or tampered', async () => {
        const prepared = await prepareUpload();
        const persistedMetadata = { ...prepared.metadata };
        const originalUrl = persistedMetadata.image_url;
        jest.setSystemTime(new Date('2026-09-08T18:16:00.000Z'));

        const mapped = conversationService.mapMessage({
            id: 'message-1',
            conversation_id: 'conversation-1',
            content: 'photo.png',
            sender: 'business',
            message_type: 'image',
            metadata: {
                ...persistedMetadata,
                image_url: 'https://assets.test.invalid/garbage',
                file_url: 'https://assets.test.invalid/garbage',
            },
            created_at: new Date().toISOString(),
        }, SHOP_ID);

        expect(mapped.metadata.image_url).not.toBe(originalUrl);
        expect(new URL(mapped.metadata.image_url).searchParams.get('expires'))
            .toBe(String(Math.floor(Date.now() / 1000) + 15 * 60));
        expect(mapped.metadata.attachment_storage_key).toBe(persistedMetadata.attachment_storage_key);
        expect(persistedMetadata.image_url).toBe(originalUrl);
    });

    test('retries an existing upload by recovering its legacy key and minting a fresh URL', async () => {
        const legacyUrl = mintAttachmentUrl({
            shopId: SHOP_ID,
            fileName: 'historical.png',
            baseUrl: 'https://assets.test.invalid',
            now: Math.floor(Date.now() / 1000) - 3600,
        });
        const prepared = await controller._private.prepareOutboundAttachmentMetadata(request(), SHOP_ID, {
            message_type: 'image',
            metadata: {
                message_type: 'image',
                image_url: legacyUrl,
                attachment_source: 'inbox_upload',
            },
        });

        expect(prepared.metadata.attachment_storage_key).toBe(storageKey);
        expect(prepared.metadata.image_url).not.toBe(legacyUrl);
        expect(new URL(prepared.metadata.image_url).searchParams.get('expires'))
            .toBe(String(Math.floor(Date.now() / 1000) + 15 * 60));
    });

    test('fails closed for cross-shop keys, foreign legacy origins, and traversal', () => {
        expect(parseStorageKey('shop-2/file.png')).toEqual({ shopId: 'shop-2', fileName: 'file.png' });
        expect(conversationService.mapMessage({
            id: 'message-2',
            conversation_id: 'conversation-1',
            content: '[Attachment]',
            sender: 'customer',
            message_type: 'image',
            metadata: {
                message_type: 'image',
                attachment_source: 'inbox_upload',
                attachment_storage_key: 'shop-2/file.png',
                image_url: 'https://assets.test.invalid/uploads/conversation-attachments/shop-2/file.png',
            },
        }, SHOP_ID).metadata).toEqual(expect.objectContaining({ attachment_available: false }));
        expect(recoverStorageKeyFromLegacyUrl(
            'https://attacker.invalid/uploads/conversation-attachments/shop-1/file.png',
            { expectedShopId: SHOP_ID },
        )).toBeNull();
        expect(recoverStorageKeyFromLegacyUrl(
            '/uploads/conversation-attachments/shop-1/%2e%2e%2Fsecret.png',
            { expectedShopId: SHOP_ID },
        )).toBeNull();
        expect(parseStorageKey('shop-1/../secret.png')).toBeNull();
        expect(parseStorageKey('shop-1/%2Fsecret.png')).toBeNull();
        expect(absolutePathForKey('shop-1/../secret.png')).toBeNull();
    });

    test('returns a visible message with unavailable metadata when the file is gone', async () => {
        await fs.rm(absolutePathForKey(storageKey), { force: true });
        Conversation.findOne = jest.fn().mockResolvedValue({ id: 'conversation-1', shop_id: SHOP_ID });
        Message.findAndCountAll = jest.fn().mockResolvedValue({
            rows: [{
                id: 'message-3',
                conversation_id: 'conversation-1',
                content: '[Attachment]',
                sender: 'customer',
                message_type: 'image',
                metadata: {
                    message_type: 'image',
                    attachment_source: 'inbox_upload',
                    attachment_storage_key: storageKey,
                    image_url: 'https://assets.test.invalid/stale',
                },
                created_at: new Date().toISOString(),
            }],
            count: 1,
        });
        Message.findAll = jest.fn().mockResolvedValue([]);

        const result = await conversationService.getMessages('conversation-1', SHOP_ID);

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].metadata).toEqual(expect.objectContaining({ attachment_available: false }));
        expect(result.messages[0].metadata.image_url).toBeUndefined();
    });

    test('provider retry mints a fresh internal URL instead of reusing stored metadata', () => {
        const staleUrl = mintAttachmentUrl({
            shopId: SHOP_ID,
            fileName: 'historical.png',
            baseUrl: 'https://assets.test.invalid',
            now: Math.floor(Date.now() / 1000) - 3600,
        });
        jest.setSystemTime(new Date('2026-09-08T19:00:00.000Z'));
        const [attachment] = controller._private.buildOutboundAttachments({
            message_type: 'image',
            metadata: {
                message_type: 'image',
                attachment_source: 'inbox_upload',
                attachment_storage_key: storageKey,
                image_url: staleUrl,
            },
        }, SHOP_ID);

        expect(attachment.url).not.toBe(staleUrl);
        expect(new URL(attachment.url).searchParams.get('expires')).toBe(
            String(Math.floor(Date.now() / 1000) + 15 * 60),
        );
    });

    test('SSE lifecycle metadata is projected with a fresh attachment URL', async () => {
        const staleUrl = mintAttachmentUrl({
            shopId: SHOP_ID,
            fileName: 'historical.png',
            baseUrl: 'https://assets.test.invalid',
            now: Math.floor(Date.now() / 1000) - 3600,
        });
        const message = {
            id: 'message-sse-1',
            conversation_id: 'conversation-1',
            sender: 'ai',
            content: '[Attachment]',
            delivery_state: 'SEND_PENDING',
            provider_message_id: null,
            metadata: {
                message_type: 'image',
                attachment_source: 'inbox_upload',
                attachment_storage_key: storageKey,
                image_url: staleUrl,
                provider_send_attempted: false,
            },
        };
        Conversation.findOne.mockResolvedValue({ id: 'conversation-1', shop_id: SHOP_ID });
        Message.findAll.mockResolvedValue([message]);
        Message.update.mockResolvedValue([1]);

        await conversationService.holdPendingAiCandidates('conversation-1', SHOP_ID);

        const lifecycleEvent = mockSseManager.emit.mock.calls.find(([, event]) => (
            event === 'message_delivery_updated'
        ));
        expect(lifecycleEvent?.[2].metadata.image_url).not.toBe(staleUrl);
        expect(lifecycleEvent?.[2].metadata.attachment_storage_key).toBe(storageKey);
        expect(new URL(lifecycleEvent[2].metadata.image_url).searchParams.get('expires'))
            .toBe(String(Math.floor(Date.now() / 1000) + 15 * 60));
    });

    test('missing signing secret fails without minting a URL', () => {
        const config = require('../../../config/config');
        const csrfSecret = config.csrfSecret;
        const sessionSecret = config.sessionSecret;
        config.csrfSecret = '';
        config.sessionSecret = '';
        try {
            expect(() => mintAttachmentUrl({
                shopId: SHOP_ID,
                fileName: 'file.png',
                baseUrl: 'https://assets.test.invalid',
            })).toThrow('Attachment signing is not configured');
        } finally {
            config.csrfSecret = csrfSecret;
            config.sessionSecret = sessionSecret;
        }
    });
});
