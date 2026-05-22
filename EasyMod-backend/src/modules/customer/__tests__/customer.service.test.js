/**
 * Customer Service — Unit Tests
 * Tests customer CRUD, consent management, and segment filtering
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../entities', () => ({
    Customer: {
        findOne: jest.fn(),
        findAll: jest.fn(),
        findAndCountAll: jest.fn(),
        findOrCreate: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
    },
    UserShop: { findOne: jest.fn() },
    Order: {
        findAll: jest.fn(),
        count: jest.fn()
    }
}));

jest.mock('../../../utils/AppError', () => ({
    AppError: class AppError extends Error {
        constructor(msg, code) { super(msg); this.statusCode = code; }
    }
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
}));

// ── Require after mocks ───────────────────────────────────────────────────────

const customerService = require('../customer.service');
const { Customer, UserShop, Order } = require('../../entities');
const { AppError } = require('../../../utils/AppError');

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCustomer = (overrides = {}) => ({
    id: 'cust-1',
    shop_id: 'shop-1',
    channel_type: 'messenger',
    channel_user_id: 'psid-abc',
    display_name: 'Test Customer',
    phone: '01711000000',
    metadata: {},
    update: jest.fn(async (data) => {
        Object.assign(cust, data);
        return cust;
    }),
    ...overrides
});

let cust;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomerService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cust = makeCustomer();
    });

    // ── getOrCreateCustomer ───────────────────────────────────────────────────

    describe('getOrCreateCustomer', () => {
        it('returns existing customer when found by channel_user_id', async () => {
            Customer.findOrCreate.mockResolvedValue([cust, false]);
            const result = await customerService.getOrCreateCustomer('shop-1', {
                channel_type: 'messenger',
                channel_user_id: 'psid-abc',
                display_name: 'Test Customer'
            });
            expect(result.id).toBe('cust-1');
        });

        it('creates customer when not found', async () => {
            const newCustomer = makeCustomer({ id: 'cust-new' });
            Customer.findOrCreate.mockResolvedValue([newCustomer, true]);
            const result = await customerService.getOrCreateCustomer('shop-1', {
                channel_type: 'instagram',
                channel_user_id: 'igid-xyz'
            });
            expect(result.id).toBe('cust-new');
        });

        it('creates with correct shop_id', async () => {
            Customer.findOrCreate.mockResolvedValue([cust, true]);
            await customerService.getOrCreateCustomer('shop-99', {
                channel_type: 'messenger',
                channel_user_id: 'psid-new'
            });
            expect(Customer.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
                defaults: expect.objectContaining({ shop_id: 'shop-99' })
            }));
        });
    });

    // ── getCustomers ──────────────────────────────────────────────────────────

    describe('getCustomers', () => {
        it('returns paginated customer list for the shop', async () => {
            Customer.findAndCountAll.mockResolvedValue({ rows: [cust], count: 1 });
            const result = await customerService.getCustomers('shop-1', { page: 1, limit: 20 });
            expect(result.rows).toHaveLength(1);
            expect(result.count).toBe(1);
            expect(Customer.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ shop_id: 'shop-1' })
            }));
        });

        it('returns empty list when no customers', async () => {
            Customer.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
            const result = await customerService.getCustomers('shop-1', {});
            expect(result.rows).toEqual([]);
        });
    });

    // ── getCustomerById ───────────────────────────────────────────────────────

    describe('getCustomerById', () => {
        it('returns customer with order count when found', async () => {
            Customer.findOne.mockResolvedValue(cust);
            Order.count.mockResolvedValue(5);
            const result = await customerService.getCustomerById('cust-1', 'user-1', 'shop-1');
            expect(result).toBeDefined();
        });

        it('throws 404 when customer not found', async () => {
            Customer.findOne.mockResolvedValue(null);
            await expect(
                customerService.getCustomerById('nonexistent', 'user-1', 'shop-1')
            ).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    // Note: campaign/marketing consent has moved to meta_channel_consent_events
    // (see consent.service.js). The old `updateCustomerConsent` / `getCustomersBySegment`
    // methods and `customer.metadata.marketing_opt_*` flags were removed in the
    // Meta integration redesign (Phase 5). Tests for those behaviours now live with
    // consent.service.
});
