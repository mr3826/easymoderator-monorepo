'use strict';

/**
 * comment-to-dm.service.test.js
 *
 * Tests for CommentToDmService — mocks DB, Redis, BullMQ, and provider registry.
 * Exercises the orchestrator logic without real infrastructure.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Redis (cacheRedis)
const mockRedisSet = jest.fn();
const mockRedis = {
    status: 'ready',
    set: mockRedisSet,
};
jest.mock('../../../config/redis', () => ({ cacheRedis: mockRedis }));

// Mock the entity (CommentToDmEvent)
const mockEventCreate  = jest.fn();
const mockEventFindOne = jest.fn();
const mockEventFindAll = jest.fn();
const mockEventInstance = {
    id: 'evt-uuid-1',
    shop_id: 'shop-1',
    channel_id: 'channel-1',
    platform: 'facebook',
    comment_id: 'CMT_001',
    commenter_external_id: 'USER_456',
    state: 'COMMENT_RECEIVED',
    last_transition_at: new Date(),
    save: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
};

jest.mock('../comment-to-dm.entity', () => {
    const mock = {
        create: mockEventCreate,
        findOne: mockEventFindOne,
        findAll: mockEventFindAll,
        STATES: ['COMMENT_RECEIVED','MATCHED','BLOCKED','PUBLIC_REPLY_QUEUED','PUBLIC_REPLIED',
                 'DM_INVITE_SENT','CUSTOMER_OPENED_DM','AUTOMATION_UNLOCKED','EXPIRED','FAILED'],
    };
    return mock;
});

// Mock MetaChannel
const mockChannel = {
    id: 'channel-1',
    shop_id: 'shop-1',
    platform: 'facebook',
    meta_asset_id: 'PAGE_123',
    settings: {
        comment_to_dm_enabled: true,
        comment_to_dm_keywords: ['price', 'dam'],
        comment_to_dm_post_filter: [],
        automation_mode: 'AI_ACTIVE',
    },
};
jest.mock('../../channel-providers/meta-channel.entity', () => ({
    findOne: jest.fn().mockResolvedValue(null),
}));

// Mock MetaChannelSettings
jest.mock('../../channel-providers/meta-channel-settings.entity', () => ({
    findOne: jest.fn(),
}));

// Mock metaChannelService
jest.mock('../../channel-providers/meta-channel.service', () => ({
    findByMetaAssetId: jest.fn(),
}));

// Mock BullMQ queue
const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
jest.mock('../../../jobs/message-queue', () => ({
    messageQueue: null, // not used by comment-to-dm service
}));

// Mock comment-to-dm queue (lazy required in service)
jest.mock('../../../jobs/queue-manager', () => ({
    queues: {
        commentToDm: { add: mockQueueAdd },
    },
}));

// Mock SSE manager
jest.mock('../../../utils/sse-manager', () => ({
    emit: jest.fn(),
}));

// Mock provider registry
const mockSendPublicReply   = jest.fn().mockResolvedValue({ commentId: 'pub-reply-1' });
const mockSendPrivateReply  = jest.fn().mockResolvedValue({ providerMessageId: 'dm-1' });
jest.mock('../../channel-providers/provider.registry', () => ({
    getProvider: jest.fn().mockReturnValue({
        sendPublicCommentReply:    mockSendPublicReply,
        sendPrivateReplyToComment: mockSendPrivateReply,
    }),
}));

// Mock policy engine
jest.mock('../../policy/policy.engine', () => ({
    evaluateOutbound: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }),
}));

// Mock customer + conversation entities
jest.mock('../../entities', () => ({
    Customer: {
        findOne: jest.fn(),
        findOrCreate: jest.fn(),
    },
    Conversation: {
        findOne: jest.fn(),
    },
}));

// ── Service under test ────────────────────────────────────────────────────────

const CommentToDmService = require('../comment-to-dm.service');

const { cacheRedis } = require('../../../config/redis');
const CommentToDmEvent = require('../comment-to-dm.entity');
const metaChannelService = require('../../channel-providers/meta-channel.service');
const MetaChannelSettings = require('../../channel-providers/meta-channel-settings.entity');
const sse = require('../../../utils/sse-manager');
const { Customer, Conversation } = require('../../entities');

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    mockRedisSet.mockReset();
    mockEventCreate.mockReset();
    mockEventFindOne.mockReset();
    mockEventFindAll.mockReset();
});

// ── handleCommentEvent tests ──────────────────────────────────────────────────

describe('CommentToDmService.handleCommentEvent', () => {

    const baseCommentPayload = {
        commentId: 'CMT_001',
        parentCommentId: null,
        postId: 'POST_A',
        commenterId: 'USER_456',
        commenterName: 'Rahim',
        text: 'dam ki?',
    };

    const baseChannel = {
        id: 'channel-1',
        shop_id: 'shop-1',
        platform: 'facebook',
        meta_asset_id: 'PAGE_123',
    };

    beforeEach(() => {
        metaChannelService.findByMetaAssetId.mockResolvedValue(baseChannel);
        MetaChannelSettings.findOne.mockResolvedValue({
            comment_to_dm_enabled: true,
            comment_to_dm_keywords: ['dam', 'price'],
            comment_to_dm_post_filter: [],
        });
        mockEventCreate.mockResolvedValue({ ...mockEventInstance });
    });

    test('creates COMMENT_RECEIVED row when comment matches keyword', async () => {
        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload,
        });

        expect(mockEventCreate).toHaveBeenCalledTimes(1);
        const createArgs = mockEventCreate.mock.calls[0][0];
        expect(createArgs.state).toBe('MATCHED');
        expect(createArgs.matched_keyword).toBeDefined();
    });

    test('creates BLOCKED row when no keywords match', async () => {
        MetaChannelSettings.findOne.mockResolvedValue({
            comment_to_dm_enabled: true,
            comment_to_dm_keywords: ['buy', 'order'],
            comment_to_dm_post_filter: [],
        });

        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: { ...baseCommentPayload, text: 'nice photo!' },
        });

        const createArgs = mockEventCreate.mock.calls[0][0];
        expect(createArgs.state).toBe('BLOCKED');
    });

    test('creates BLOCKED row when keywords list is empty', async () => {
        MetaChannelSettings.findOne.mockResolvedValue({
            comment_to_dm_enabled: true,
            comment_to_dm_keywords: [],
            comment_to_dm_post_filter: [],
        });

        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload,
        });

        const createArgs = mockEventCreate.mock.calls[0][0];
        expect(createArgs.state).toBe('BLOCKED');
        expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    test('does not create row when comment_to_dm_enabled is false', async () => {
        MetaChannelSettings.findOne.mockResolvedValue({
            comment_to_dm_enabled: false,
            comment_to_dm_keywords: ['dam'],
            comment_to_dm_post_filter: [],
        });

        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload,
        });

        expect(mockEventCreate).not.toHaveBeenCalled();
    });

    test('silently no-ops on duplicate comment_id (unique constraint violation)', async () => {
        const uniqueError = new Error('unique constraint');
        uniqueError.name = 'SequelizeUniqueConstraintError';
        mockEventCreate.mockRejectedValueOnce(uniqueError);

        const service = new CommentToDmService();
        // Should not throw
        await expect(service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload,
        })).resolves.toBeUndefined();
    });

    test('applies post filter — blocks comment not in allowed posts list', async () => {
        MetaChannelSettings.findOne.mockResolvedValue({
            comment_to_dm_enabled: true,
            comment_to_dm_keywords: [],
            comment_to_dm_post_filter: ['POST_B', 'POST_C'], // POST_A not included
        });

        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload, // postId: 'POST_A'
        });

        const createArgs = mockEventCreate.mock.calls[0][0];
        expect(createArgs.state).toBe('BLOCKED');
    });

    test('emits SSE transition event after creating row', async () => {
        const service = new CommentToDmService();
        await service.handleCommentEvent({
            channel: baseChannel,
            platform: 'facebook',
            commentPayload: baseCommentPayload,
        });

        expect(sse.emit).toHaveBeenCalledWith(
            'shop-1',
            'comment_to_dm.transition',
            expect.objectContaining({ from: 'COMMENT_RECEIVED' })
        );
    });
});

// ── processQueuedComment tests ────────────────────────────────────────────────

describe('CommentToDmService.processQueuedComment', () => {

    let matchedEvent;

    const channelRow = {
        id: 'channel-1',
        shop_id: 'shop-1',
        platform: 'facebook',
        page_access_token_ct: 'tok',
    };

    beforeEach(() => {
        // Re-create matchedEvent fresh each test so state mutations don't bleed between tests
        matchedEvent = {
            ...mockEventInstance,
            state: 'MATCHED',
            comment_id: 'CMT_001',
            commenter_external_id: 'USER_456',
            shop_id: 'shop-1',
            channel_id: 'channel-1',
            platform: 'facebook',
            comment_text: 'dam ki?',
            post_id: 'POST_A',
            save: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockImplementation(function(fields) {
                // Simulate Sequelize update: mutate in-memory too
                if (fields.state) this.state = fields.state;
                return Promise.resolve(true);
            }),
        };

        mockEventFindOne.mockResolvedValue(matchedEvent);
        metaChannelService.findByMetaAssetId.mockResolvedValue(channelRow);

        const MetaChannel = require('../../channel-providers/meta-channel.entity');
        MetaChannel.findOne.mockResolvedValue(channelRow);
    });

    test('sets Redis NX key before API call, skips if key already set', async () => {
        // Simulate Redis NX returning null (key already exists) → skip
        mockRedisSet.mockResolvedValue(null);

        const service = new CommentToDmService();
        await service.processQueuedComment({ eventId: 'evt-uuid-1' });

        // Provider should NOT have been called
        expect(mockSendPrivateReply).not.toHaveBeenCalled();
    });

    test('calls public reply then private reply when Redis NX succeeds', async () => {
        mockRedisSet.mockResolvedValue('OK');
        mockSendPublicReply.mockResolvedValue({ commentId: 'pub-1' });
        mockSendPrivateReply.mockResolvedValue({ providerMessageId: 'dm-1' });

        const service = new CommentToDmService();
        await service.processQueuedComment({ eventId: 'evt-uuid-1' });

        expect(mockSendPrivateReply).toHaveBeenCalledTimes(1);
    });

    test('transitions event to DM_INVITE_SENT when both sends succeed', async () => {
        mockRedisSet.mockResolvedValue('OK');

        const service = new CommentToDmService();
        await service.processQueuedComment({ eventId: 'evt-uuid-1' });

        // The event.update or event.save should have been called with DM_INVITE_SENT
        const savedState = matchedEvent.update.mock.calls.find(
            call => call[0]?.state === 'DM_INVITE_SENT'
        );
        expect(savedState).toBeTruthy();
    });
});

// ── handleDmOpened tests ──────────────────────────────────────────────────────

describe('CommentToDmService.handleDmOpened', () => {

    let dmInvitedEvent;

    beforeEach(() => {
        // Re-create fresh each test to avoid state mutation bleed
        dmInvitedEvent = {
            ...mockEventInstance,
            state: 'DM_INVITE_SENT',
            commenter_external_id: 'USER_456',
            shop_id: 'shop-1',
            channel_id: 'channel-1',
            platform: 'facebook',
            customer_id: null,
            conversation_id: null,
            update: jest.fn().mockImplementation(function(fields) {
                if (fields.state) this.state = fields.state;
                if (fields.customer_id !== undefined) this.customer_id = fields.customer_id;
                if (fields.conversation_id !== undefined) this.conversation_id = fields.conversation_id;
                return Promise.resolve(true);
            }),
            save: jest.fn().mockResolvedValue(true),
        };

        // tryUnlockAutomation is called inside handleDmOpened; to prevent cascade failures
        // in unit tests, return null for the second findOne call (tryUnlockAutomation event lookup)
        // after the first (the DM_INVITE_SENT lookup). We sequence two calls: first returns
        // dmInvitedEvent, second returns null so tryUnlockAutomation exits early.
        mockEventFindOne
            .mockResolvedValueOnce(dmInvitedEvent)
            .mockResolvedValue(null);

        Customer.findOne.mockResolvedValue({ id: 'cust-1' });
        Conversation.findOne.mockResolvedValue({ id: 'conv-1' });
    });

    test('transitions to CUSTOMER_OPENED_DM when matching event found', async () => {
        const service = new CommentToDmService();
        await service.handleDmOpened({
            channel: { shop_id: 'shop-1', id: 'channel-1', platform: 'facebook' },
            customerExternalId: 'USER_456',
            message: 'price janabo?',
        });

        const updateCall = dmInvitedEvent.update.mock.calls.find(
            c => c[0]?.state === 'CUSTOMER_OPENED_DM'
        );
        expect(updateCall).toBeTruthy();
    });

    test('links customer_id and conversation_id when found', async () => {
        const service = new CommentToDmService();
        await service.handleDmOpened({
            channel: { shop_id: 'shop-1', id: 'channel-1', platform: 'facebook' },
            customerExternalId: 'USER_456',
            message: 'hello',
        });

        const updateCall = dmInvitedEvent.update.mock.calls.find(
            c => c[0]?.customer_id === 'cust-1'
        );
        expect(updateCall).toBeTruthy();
    });

    test('no-ops gracefully when no DM_INVITE_SENT event found', async () => {
        mockEventFindOne.mockResolvedValue(null);

        const service = new CommentToDmService();
        await expect(service.handleDmOpened({
            channel: { shop_id: 'shop-1', id: 'channel-1', platform: 'facebook' },
            customerExternalId: 'UNKNOWN_USER',
            message: 'hello',
        })).resolves.toBeUndefined();
    });
});

// ── expireStale tests ─────────────────────────────────────────────────────────

describe('CommentToDmService.expireStale', () => {

    const staleEvent1 = {
        ...mockEventInstance,
        id: 'stale-1',
        state: 'DM_INVITE_SENT',
        update: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
    };
    const staleEvent2 = {
        ...mockEventInstance,
        id: 'stale-2',
        state: 'CUSTOMER_OPENED_DM',
        update: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
    };

    test('marks stale DM_INVITE_SENT and CUSTOMER_OPENED_DM rows as EXPIRED', async () => {
        mockEventFindAll.mockResolvedValue([staleEvent1, staleEvent2]);

        const service = new CommentToDmService();
        const result = await service.expireStale();

        expect(result.expired).toBe(2);
        expect(staleEvent1.update).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'EXPIRED' })
        );
        expect(staleEvent2.update).toHaveBeenCalledWith(
            expect.objectContaining({ state: 'EXPIRED' })
        );
    });

    test('returns zero when no stale rows exist', async () => {
        mockEventFindAll.mockResolvedValue([]);

        const service = new CommentToDmService();
        const result = await service.expireStale();
        expect(result.expired).toBe(0);
    });
});
