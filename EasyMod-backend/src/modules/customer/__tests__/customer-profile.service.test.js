/**
 * Tests for customer-profile.service — best-effort real-name enrichment from the
 * Meta Graph user-profile API.
 *
 * Founder feedback 2026-06-12: every conversation showed "Customer" because the
 * webhook payload carries only the PSID. This service replaces that placeholder
 * with the real Facebook/Instagram name, and must NEVER throw on the hot path.
 */

jest.mock('axios');
jest.mock('../../../config/config', () => ({ metaAppSecret: 'app-secret' }));
const mockMetaChannelService = {
    findConnectedById: jest.fn(),
    findUniqueConnectedByShopAndPlatform: jest.fn(),
};
jest.mock('../../channel-providers/meta-channel.service', () => mockMetaChannelService);
jest.mock('../customer.entity', () => ({ findByPk: jest.fn() }));

const axios = require('axios');
const metaChannelService = require('../../channel-providers/meta-channel.service');
const Customer = require('../customer.entity');
const { enrichCustomerNameFromMeta, isPlaceholderName } = require('../customer-profile.service');
const originalProfileFlag = process.env.META_USER_PROFILE_ENABLED;

const makeCustomer = (overrides = {}) => ({
    id: 'cust-1',
    name: 'Customer',
    metadata: {},
    update: jest.fn().mockResolvedValue(true),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_USER_PROFILE_ENABLED = 'true';
    metaChannelService.findConnectedById.mockResolvedValue({
        id: 'mc-1',
        shop_id: 'shop-1',
        platform: 'facebook',
        status: 'CONNECTED',
        page_access_token_ct: 'page-token',
    });
    metaChannelService.findUniqueConnectedByShopAndPlatform.mockResolvedValue({
        id: 'mc-1',
        shop_id: 'shop-1',
        platform: 'facebook',
        status: 'CONNECTED',
        page_access_token_ct: 'page-token',
    });
});

afterAll(() => {
    if (originalProfileFlag === undefined) delete process.env.META_USER_PROFILE_ENABLED;
    else process.env.META_USER_PROFILE_ENABLED = originalProfileFlag;
});

describe('isPlaceholderName', () => {
    test.each(['Customer', 'Customer 1234', 'facebook user', 'Facebook User', 'messenger user', 'Instagram User', '', null, undefined])('treats "%s" as a placeholder', (n) => {
        expect(isPlaceholderName(n)).toBe(true);
    });
    test.each(['Evan Ahmed', 'Jia'])('treats "%s" as a real name', (n) => {
        expect(isPlaceholderName(n)).toBe(false);
    });
});

describe('enrichCustomerNameFromMeta', () => {
    test('does not call Meta when profile enrichment is disabled', async () => {
        delete process.env.META_USER_PROFILE_ENABLED;
        Customer.findByPk.mockResolvedValue(makeCustomer());

        const updated = await enrichCustomerNameFromMeta({
            customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'fb-psid-9',
        });

        expect(updated).toBe(false);
        expect(Customer.findByPk).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('replaces the placeholder with first+last name and stores profile pic', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { first_name: 'Evan', last_name: 'Ahmed', profile_pic: 'https://pic/x.jpg' } });

        const updated = await enrichCustomerNameFromMeta({
            customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'fb-psid-9',
        });

        expect(updated).toBe(true);
        expect(customer.update).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Evan Ahmed',
            metadata: expect.objectContaining({ first_name: 'Evan', last_name: 'Ahmed', profile_pic: 'https://pic/x.jpg' }),
        }));
        // appsecret_proof must be sent with page-token calls.
        const params = axios.get.mock.calls[0][1].params;
        expect(params.appsecret_proof).toBeDefined();
        expect(params.access_token).toBe('page-token');
    });

    test('uses the Instagram `name` field when first/last are absent', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { name: 'Rahim Uddin', username: 'rahim' } });

        await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'ig-1' });

        expect(customer.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rahim Uddin' }));
    });

    test('does not overwrite a real name', async () => {
        const customer = makeCustomer({
            name: 'Already Real',
            metadata: { first_name: 'Already', last_name: 'Real', profile_pic: 'https://pic/existing.jpg' },
        });
        Customer.findByPk.mockResolvedValue(customer);

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'p' });

        expect(updated).toBe(false);
        expect(axios.get).not.toHaveBeenCalled();
        expect(customer.update).not.toHaveBeenCalled();
    });

    test('fills missing profile metadata without overwriting a real name', async () => {
        const customer = makeCustomer({ name: 'Already Real', metadata: {} });
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { first_name: 'Meta', last_name: 'Person', profile_pic: 'https://pic/meta.jpg' } });

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'p' });

        expect(updated).toBe(true);
        expect(customer.update).toHaveBeenCalledWith({
            metadata: expect.objectContaining({
                first_name: 'Meta',
                last_name: 'Person',
                profile_pic: 'https://pic/meta.jpg',
            }),
        });
        expect(customer.update.mock.calls[0][0]).not.toHaveProperty('name');
    });

    test('is non-fatal when the Graph call fails (403/permission)', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockRejectedValue({ response: { data: { error: { message: 'permission' } } } });

        await expect(
            enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', shopId: 'shop-1', platform: 'messenger', psid: 'p' })
        ).resolves.toBe(false);
        expect(customer.update).not.toHaveBeenCalled();
    });

    test('skips when no channel/token can be resolved', async () => {
        Customer.findByPk.mockResolvedValue(makeCustomer());
        metaChannelService.findUniqueConnectedByShopAndPlatform.mockResolvedValue(null);

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', psid: 'p', shopId: 's', platform: 'messenger' });

        expect(updated).toBe(false);
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('uses the unique connected Facebook channel when no exact channel id is supplied', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { name: 'Unique Page User' } });

        const updated = await enrichCustomerNameFromMeta({
            customerId: 'cust-1',
            shopId: 'shop-1',
            platform: 'messenger',
            psid: 'p',
        });

        expect(updated).toBe(true);
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).toHaveBeenCalledWith(
            'shop-1',
            'facebook',
        );
    });

    test('does not fall back when an explicit channel belongs to another shop or is not routable', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        metaChannelService.findConnectedById.mockResolvedValue(null);

        const updated = await enrichCustomerNameFromMeta({
            customerId: 'cust-1',
            metaChannelId: 'foreign-channel',
            shopId: 'shop-1',
            platform: 'messenger',
            psid: 'p',
        });

        expect(updated).toBe(false);
        expect(metaChannelService.findConnectedById).toHaveBeenCalledWith('foreign-channel', {
            shopId: 'shop-1',
            platform: 'facebook',
        });
        expect(metaChannelService.findUniqueConnectedByShopAndPlatform).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
    });
});
