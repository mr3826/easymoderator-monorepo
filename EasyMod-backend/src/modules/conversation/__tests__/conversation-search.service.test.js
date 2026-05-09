'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mock: entities (Conversation, ConversationMessage, Customer, sequelize)
// ---------------------------------------------------------------------------
const mockConversationFindAll = jest.fn();
const mockConversationFindOne = jest.fn();
const mockConversationMessageFindAll = jest.fn();
const mockSequelizeQuery = jest.fn();

jest.mock('../../entities', () => ({
    Conversation: {
        findAll: (...args) => mockConversationFindAll(...args),
        findOne: (...args) => mockConversationFindOne(...args)
    },
    ConversationMessage: {
        findAll: (...args) => mockConversationMessageFindAll(...args)
    },
    Customer: {},
    sequelize: {
        query: (...args) => mockSequelizeQuery(...args),
        QueryTypes: { SELECT: 'SELECT' }
    }
}));

// ---------------------------------------------------------------------------
// Mock: AppError (preserve real implementation so instanceof checks work)
// ---------------------------------------------------------------------------
jest.mock('../../../utils/AppError', () => {
    const { AppError } = jest.requireActual('../../../utils/AppError');
    return { AppError };
});

// ---------------------------------------------------------------------------
// Module under test — required AFTER all mocks
// ---------------------------------------------------------------------------
const {
    searchConversations,
    parseSearchQuery,
    searchWithinConversation,
    getSearchSuggestions,
    indexMessageForSearch
} = require('../conversation-search.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SHOP_ID = 'shop-search-1';

const makeConversation = (overrides = {}) => ({
    id: 'conv-1',
    customer_id: 'cust-1',
    customer: { name: 'Alice', phone: '+880700' },
    status: 'active',
    channel_type: 'facebook',
    message_count: 5,
    last_message_at: new Date('2025-01-01'),
    created_at: new Date('2025-01-01'),
    latest_order_id: null,
    ...overrides
});

const makeMessageRow = (overrides = {}) => ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    body: 'Hello refund',
    sender: 'customer',
    created_at: new Date('2025-01-01'),
    status: 'active',
    customer_name: 'Alice',
    customer_phone: '+880700',
    ...overrides
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('conversation-search.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: query returns empty results unless overridden
        mockSequelizeQuery.mockResolvedValue([]);
        mockConversationFindAll.mockResolvedValue([]);
    });

    // =========================================================================
    // searchConversations
    // =========================================================================
    describe('searchConversations', () => {
        it('should throw AppError 400 when query is shorter than 2 characters', async () => {
            const { AppError } = require('../../../utils/AppError');

            await expect(searchConversations(SHOP_ID, 'a')).rejects.toBeInstanceOf(AppError);
            await expect(searchConversations(SHOP_ID, 'a')).rejects.toMatchObject({ status: 400 });
        });

        it('should throw AppError 400 when query is empty string', async () => {
            const { AppError } = require('../../../utils/AppError');

            await expect(searchConversations(SHOP_ID, '')).rejects.toBeInstanceOf(AppError);
        });

        it('should throw AppError 400 when query is null', async () => {
            const { AppError } = require('../../../utils/AppError');

            await expect(searchConversations(SHOP_ID, null)).rejects.toBeInstanceOf(AppError);
        });

        it('should return structured result object with correct shape on success', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            const result = await searchConversations(SHOP_ID, 'refund');

            expect(result).toMatchObject({
                conversations: expect.any(Array),
                messages: expect.any(Array),
                customers: expect.any(Array),
                totalResults: expect.any(Number),
                query: 'refund',
                searchType: 'all'
            });
        });

        it('should return message results mapped to expected shape', async () => {
            const msgRow = makeMessageRow();
            // First query = messages, second query = customers
            mockSequelizeQuery
                .mockResolvedValueOnce([msgRow])  // messages query
                .mockResolvedValueOnce([]);        // customers query

            // conversations from message IDs
            mockConversationFindAll.mockResolvedValue([makeConversation()]);

            const result = await searchConversations(SHOP_ID, 'refund');

            expect(result.messages).toHaveLength(1);
            expect(result.messages[0]).toMatchObject({
                id: 'msg-1',
                conversationId: 'conv-1',
                body: 'Hello refund',
                sender: 'customer',
                customerName: 'Alice',
                customerPhone: '+880700',
                conversationStatus: 'active'
            });
        });

        it('should return customer results mapped to expected shape', async () => {
            const customerRow = {
                customer_id: 'cust-99',
                name: 'Bob',
                phone: '+880999',
                conversation_count: 3,
                last_contact: new Date('2025-02-01')
            };
            mockSequelizeQuery
                .mockResolvedValueOnce([])          // messages
                .mockResolvedValueOnce([customerRow]); // customers

            const result = await searchConversations(SHOP_ID, 'Bob');

            expect(result.customers).toHaveLength(1);
            expect(result.customers[0]).toMatchObject({
                id: 'cust-99',
                name: 'Bob',
                phone: '+880999',
                conversationCount: 3
            });
        });

        it('should return empty results when nothing matches', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            const result = await searchConversations(SHOP_ID, 'xyzzy');

            expect(result.messages).toHaveLength(0);
            expect(result.customers).toHaveLength(0);
            expect(result.conversations).toHaveLength(0);
            expect(result.totalResults).toBe(0);
        });

        it('should apply the status option to conversation SQL when provided', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            await searchConversations(SHOP_ID, 'test', { status: 'pending' });

            const [sql] = mockSequelizeQuery.mock.calls[0];
            expect(sql).toContain('c.status = :status');
        });

        it('should include date range filters in SQL when dateFrom/dateTo provided', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            await searchConversations(SHOP_ID, 'hello', {
                dateFrom: '2025-01-01',
                dateTo: '2025-12-31'
            });

            const [sql] = mockSequelizeQuery.mock.calls[0];
            expect(sql).toContain(':dateFrom');
            expect(sql).toContain(':dateTo');
        });

        it('should only run messages query when searchType is "messages"', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            await searchConversations(SHOP_ID, 'test', { searchType: 'messages' });

            // Only one sequelize.query call — for messages, customers skipped
            const callCount = mockSequelizeQuery.mock.calls.length;
            expect(callCount).toBe(1);
        });

        it('should only run customers query when searchType is "customers"', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            await searchConversations(SHOP_ID, 'Alice', { searchType: 'customers' });

            const callCount = mockSequelizeQuery.mock.calls.length;
            expect(callCount).toBe(1);
        });

        it('should accumulate totalResults from messages length', async () => {
            const msgs = [makeMessageRow({ id: 'm1' }), makeMessageRow({ id: 'm2' })];
            mockSequelizeQuery
                .mockResolvedValueOnce(msgs)
                .mockResolvedValueOnce([]);
            mockConversationFindAll.mockResolvedValue([makeConversation()]);

            const result = await searchConversations(SHOP_ID, 'refund');

            expect(result.totalResults).toBeGreaterThanOrEqual(2);
        });

        it('should use shopId and searchText as replacements in query', async () => {
            mockSequelizeQuery.mockResolvedValue([]);

            await searchConversations(SHOP_ID, 'test query');

            const [, opts] = mockSequelizeQuery.mock.calls[0];
            expect(opts.replacements.shopId).toBe(SHOP_ID);
            expect(opts.replacements.searchText).toBe('%test query%');
        });
    });

    // =========================================================================
    // parseSearchQuery
    // =========================================================================
    describe('parseSearchQuery', () => {
        it('should return plain query text unchanged when no special syntax', () => {
            const result = parseSearchQuery('refund please');

            expect(result.searchText).toBe('refund please');
            expect(result.searchFilters).toEqual({});
        });

        it('should extract status filter and remove it from searchText', () => {
            const result = parseSearchQuery('status:pending refund');

            expect(result.searchFilters.status).toBe('pending');
            expect(result.searchText).toBe('refund');
        });

        it('should extract date filter and remove it from searchText', () => {
            const result = parseSearchQuery('date:2025-03-15 complaint');

            expect(result.searchFilters.date).toBe('2025-03-15');
            expect(result.searchText).toBe('complaint');
        });

        it('should extract channel filter and remove it from searchText', () => {
            const result = parseSearchQuery('channel:facebook order');

            expect(result.searchFilters.channel).toBe('facebook');
            expect(result.searchText).toBe('order');
        });

        it('should handle multiple filters combined in a single query', () => {
            const result = parseSearchQuery('status:active channel:messenger refund');

            expect(result.searchFilters.status).toBe('active');
            expect(result.searchFilters.channel).toBe('messenger');
            expect(result.searchText).toBe('refund');
        });

        it('should return wildcard searchText when only filters are present', () => {
            const result = parseSearchQuery('status:pending');

            expect(result.searchFilters.status).toBe('pending');
            expect(result.searchText).toBe('*');
        });

        it('should be case-insensitive for filter keywords', () => {
            const result = parseSearchQuery('STATUS:Active hello');

            expect(result.searchFilters.status).toBe('Active');
            expect(result.searchText).toBe('hello');
        });

        it('should not extract partial date strings (requires YYYY-MM-DD)', () => {
            const result = parseSearchQuery('date:2025 order');

            // date:2025 doesn't match the YYYY-MM-DD regex — filters should be empty
            expect(result.searchFilters.date).toBeUndefined();
        });

        it('should preserve remaining text after removing all matched filters', () => {
            const result = parseSearchQuery('status:closed date:2025-06-01 invoice');

            expect(result.searchText).toBe('invoice');
            expect(result.searchFilters.status).toBe('closed');
            expect(result.searchFilters.date).toBe('2025-06-01');
        });

        it('should return empty filters object for a plain two-word query', () => {
            const result = parseSearchQuery('order help');

            expect(result.searchFilters).toEqual({});
            expect(result.searchText).toBe('order help');
        });
    });

    // =========================================================================
    // searchWithinConversation
    // =========================================================================
    describe('searchWithinConversation', () => {
        it('should throw AppError 404 when conversation not found', async () => {
            const { AppError } = require('../../../utils/AppError');
            mockConversationFindOne.mockResolvedValue(null);

            await expect(
                searchWithinConversation('conv-missing', SHOP_ID, 'refund')
            ).rejects.toBeInstanceOf(AppError);

            await expect(
                searchWithinConversation('conv-missing', SHOP_ID, 'refund')
            ).rejects.toMatchObject({ status: 404 });
        });

        it('should query messages with LIKE filter on the conversation id', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockConversationMessageFindAll.mockResolvedValue([]);

            await searchWithinConversation('conv-1', SHOP_ID, 'refund');

            expect(mockConversationMessageFindAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ conversation_id: 'conv-1' })
                })
            );
        });

        it('should return matching messages array', async () => {
            const msg = { id: 'msg-1', body: 'I want a refund', conversation_id: 'conv-1' };
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockConversationMessageFindAll.mockResolvedValue([msg]);

            const result = await searchWithinConversation('conv-1', SHOP_ID, 'refund');

            expect(result).toEqual([msg]);
        });

        it('should return empty array when no messages match', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockConversationMessageFindAll.mockResolvedValue([]);

            const result = await searchWithinConversation('conv-1', SHOP_ID, 'xyzzy');

            expect(result).toEqual([]);
        });

        it('should verify shop_id when looking up conversation', async () => {
            mockConversationFindOne.mockResolvedValue(makeConversation());
            mockConversationMessageFindAll.mockResolvedValue([]);

            await searchWithinConversation('conv-1', SHOP_ID, 'test');

            expect(mockConversationFindOne).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'conv-1', shop_id: SHOP_ID } })
            );
        });
    });

    // =========================================================================
    // getSearchSuggestions
    // =========================================================================
    describe('getSearchSuggestions', () => {
        it('should return empty array when partial is less than 2 characters', async () => {
            const result = await getSearchSuggestions(SHOP_ID, 'a');
            expect(result).toEqual([]);
        });

        it('should return empty array when partial is empty', async () => {
            const result = await getSearchSuggestions(SHOP_ID, '');
            expect(result).toEqual([]);
        });

        it('should include matching status suggestions for "status" prefix', async () => {
            mockSequelizeQuery.mockResolvedValue([]); // no customer name matches

            const result = await getSearchSuggestions(SHOP_ID, 'status');

            const texts = result.map(s => s.text);
            expect(texts).toContain('status:pending');
            expect(texts).toContain('status:active');
        });

        it('should return customer name suggestions from DB', async () => {
            mockSequelizeQuery.mockResolvedValue([{ name: 'Alice' }, { name: 'Alicia' }]);

            const result = await getSearchSuggestions(SHOP_ID, 'Ali');

            const texts = result.map(s => s.text);
            expect(texts).toContain('Alice');
            expect(texts).toContain('Alicia');
        });

        it('should not throw on DB failure — returns empty array instead', async () => {
            mockSequelizeQuery.mockRejectedValue(new Error('DB error'));

            const result = await getSearchSuggestions(SHOP_ID, 'test');

            expect(Array.isArray(result)).toBe(true);
        });
    });

    // =========================================================================
    // indexMessageForSearch
    // =========================================================================
    describe('indexMessageForSearch', () => {
        it('should not throw for any input', async () => {
            await expect(
                indexMessageForSearch('conv-1', 'message content here')
            ).resolves.toBeUndefined();
        });

        it('should be a no-op (does not call any DB methods)', async () => {
            await indexMessageForSearch('conv-1', 'hello world');

            expect(mockSequelizeQuery).not.toHaveBeenCalled();
            expect(mockConversationFindAll).not.toHaveBeenCalled();
        });
    });
});
