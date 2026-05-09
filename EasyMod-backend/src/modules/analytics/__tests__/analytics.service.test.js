'use strict';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require() of the module under test
// ---------------------------------------------------------------------------

const mockSequelizeQuery = jest.fn();

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        query: mockSequelizeQuery
    }
}));

// KnowledgeGap entity is imported by the service but only referenced for type
// purposes (Sequelize model); the actual data flows through raw sequelize.query.
jest.mock('../knowledge-gap.entity', () => ({}));

// conversation.entity exports { Message, Conversation }
jest.mock('../../conversation/conversation.entity', () => ({
    Message: {},
    Conversation: {}
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const {
    getTopUnansweredQuestions,
    getPeakHours,
    getIntentBreakdown,
    getConfidenceDistribution
} = require('../analytics-enhanced.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHOP_ID = 'shop-uuid-analytics-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics-enhanced.service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // getTopUnansweredQuestions
    // -----------------------------------------------------------------------

    describe('getTopUnansweredQuestions', () => {
        it('returns an array of { question, count } objects', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { question: 'Where is my order?', count: '15' },
                { question: 'Can I return this?', count: '8' }
            ]);

            const result = await getTopUnansweredQuestions(SHOP_ID);

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toEqual({ question: 'Where is my order?', count: 15 });
            expect(result[1]).toEqual({ question: 'Can I return this?', count: 8 });
        });

        it('parses count as integer (DB returns strings)', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { question: 'Test question', count: '42' }
            ]);

            const result = await getTopUnansweredQuestions(SHOP_ID);
            expect(typeof result[0].count).toBe('number');
            expect(result[0].count).toBe(42);
        });

        it('respects the limit parameter by passing it to the query', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getTopUnansweredQuestions(SHOP_ID, 5);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ limit: 5 })
                })
            );
        });

        it('defaults to limit=10 when not specified', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getTopUnansweredQuestions(SHOP_ID);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ limit: 10 })
                })
            );
        });

        it('returns an empty array when DB returns no rows', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            const result = await getTopUnansweredQuestions(SHOP_ID);
            expect(result).toEqual([]);
        });

        it('passes shopId correctly to the SQL replacements', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getTopUnansweredQuestions(SHOP_ID, 10);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ shopId: SHOP_ID })
                })
            );
        });

        it('uses parseInt fallback of 10 when limit is non-numeric', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getTopUnansweredQuestions(SHOP_ID, 'bad-limit');

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ limit: 10 })
                })
            );
        });
    });

    // -----------------------------------------------------------------------
    // getPeakHours
    // -----------------------------------------------------------------------

    describe('getPeakHours', () => {
        it('always returns exactly 24 entries (hours 0 through 23)', async () => {
            // DB only returns hours that have data
            mockSequelizeQuery.mockResolvedValueOnce([
                { hour: '9', count: '120' },
                { hour: '14', count: '85' }
            ]);

            const result = await getPeakHours(SHOP_ID);

            expect(result).toHaveLength(24);
        });

        it('hour values range from 0 to 23 in ascending order', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            const result = await getPeakHours(SHOP_ID);

            result.forEach((entry, idx) => {
                expect(entry.hour).toBe(idx);
            });
        });

        it('fills missing hours with count=0', async () => {
            // Only hour 10 has data
            mockSequelizeQuery.mockResolvedValueOnce([
                { hour: '10', count: '50' }
            ]);

            const result = await getPeakHours(SHOP_ID);

            // Every other hour should be 0
            result.forEach(entry => {
                if (entry.hour !== 10) {
                    expect(entry.count).toBe(0);
                }
            });
        });

        it('correctly maps DB hour data to the right slot', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { hour: '3', count: '7' },
                { hour: '22', count: '33' }
            ]);

            const result = await getPeakHours(SHOP_ID);

            expect(result[3]).toEqual({ hour: 3, count: 7 });
            expect(result[22]).toEqual({ hour: 22, count: 33 });
        });

        it('parses hour and count as integers', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { hour: '15', count: '200' }
            ]);

            const result = await getPeakHours(SHOP_ID);
            const hourFifteen = result.find(e => e.hour === 15);

            expect(typeof hourFifteen.hour).toBe('number');
            expect(typeof hourFifteen.count).toBe('number');
            expect(hourFifteen.count).toBe(200);
        });

        it('passes shopId and days to SQL replacements', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getPeakHours(SHOP_ID, 7);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ shopId: SHOP_ID, days: 7 })
                })
            );
        });

        it('defaults to days=30 when not specified', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getPeakHours(SHOP_ID);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ days: 30 })
                })
            );
        });

        it('returns all zeros when DB is empty', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            const result = await getPeakHours(SHOP_ID);

            expect(result).toHaveLength(24);
            result.forEach(entry => expect(entry.count).toBe(0));
        });
    });

    // -----------------------------------------------------------------------
    // getIntentBreakdown
    // -----------------------------------------------------------------------

    describe('getIntentBreakdown', () => {
        it('returns an array of { intent, count } objects', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { intent: 'shipping_inquiry', count: '45' },
                { intent: 'return_request', count: '22' }
            ]);

            const result = await getIntentBreakdown(SHOP_ID);

            expect(result).toEqual([
                { intent: 'shipping_inquiry', count: 45 },
                { intent: 'return_request', count: 22 }
            ]);
        });

        it('parses count as integer from string DB values', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { intent: 'greeting', count: '100' }
            ]);

            const result = await getIntentBreakdown(SHOP_ID);
            expect(typeof result[0].count).toBe('number');
        });

        it('returns an empty array when no conversations have intents', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            const result = await getIntentBreakdown(SHOP_ID);
            expect(result).toEqual([]);
        });

        it('passes shopId and days to SQL replacements', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getIntentBreakdown(SHOP_ID, 14);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ shopId: SHOP_ID, days: 14 })
                })
            );
        });

        it('defaults to days=30 when not specified', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getIntentBreakdown(SHOP_ID);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ days: 30 })
                })
            );
        });

        it('correctly groups multiple intents', async () => {
            const rawResults = [
                { intent: 'faq', count: '80' },
                { intent: 'complaint', count: '30' },
                { intent: 'compliment', count: '5' }
            ];
            mockSequelizeQuery.mockResolvedValueOnce(rawResults);

            const result = await getIntentBreakdown(SHOP_ID);

            expect(result).toHaveLength(3);
            expect(result.map(r => r.intent)).toEqual(['faq', 'complaint', 'compliment']);
        });

        it('uses parseInt fallback of 30 when days is non-numeric', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getIntentBreakdown(SHOP_ID, 'invalid');

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ days: 30 })
                })
            );
        });
    });

    // -----------------------------------------------------------------------
    // getConfidenceDistribution
    // -----------------------------------------------------------------------

    describe('getConfidenceDistribution', () => {
        it('returns an array of { range, count } objects', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { range: '0-25', count: '10' },
                { range: '25-50', count: '20' },
                { range: '50-75', count: '30' },
                { range: '75-100', count: '40' }
            ]);

            const result = await getConfidenceDistribution(SHOP_ID);

            expect(result).toEqual([
                { range: '0-25', count: 10 },
                { range: '25-50', count: 20 },
                { range: '50-75', count: 30 },
                { range: '75-100', count: 40 }
            ]);
        });

        it('correctly handles the "unknown" bucket (null ai_confidence)', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { range: 'unknown', count: '55' }
            ]);

            const result = await getConfidenceDistribution(SHOP_ID);
            expect(result[0]).toEqual({ range: 'unknown', count: 55 });
        });

        it('parses counts as integers', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([
                { range: '75-100', count: '999' }
            ]);

            const result = await getConfidenceDistribution(SHOP_ID);
            expect(typeof result[0].count).toBe('number');
            expect(result[0].count).toBe(999);
        });

        it('returns an empty array when no messages are in range', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            const result = await getConfidenceDistribution(SHOP_ID);
            expect(result).toEqual([]);
        });

        it('passes shopId and days to SQL replacements', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getConfidenceDistribution(SHOP_ID, 60);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ shopId: SHOP_ID, days: 60 })
                })
            );
        });

        it('defaults to days=30 when not specified', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getConfidenceDistribution(SHOP_ID);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ days: 30 })
                })
            );
        });

        it('handles a full distribution across all four buckets plus unknown', async () => {
            const allBuckets = [
                { range: '0-25', count: '5' },
                { range: '25-50', count: '15' },
                { range: '50-75', count: '25' },
                { range: '75-100', count: '35' },
                { range: 'unknown', count: '3' }
            ];
            mockSequelizeQuery.mockResolvedValueOnce(allBuckets);

            const result = await getConfidenceDistribution(SHOP_ID);
            expect(result).toHaveLength(5);
            const ranges = result.map(r => r.range);
            expect(ranges).toContain('0-25');
            expect(ranges).toContain('25-50');
            expect(ranges).toContain('50-75');
            expect(ranges).toContain('75-100');
            expect(ranges).toContain('unknown');
        });

        it('uses parseInt fallback of 30 when days is non-numeric', async () => {
            mockSequelizeQuery.mockResolvedValueOnce([]);

            await getConfidenceDistribution(SHOP_ID, NaN);

            expect(mockSequelizeQuery).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    replacements: expect.objectContaining({ days: 30 })
                })
            );
        });
    });
});
