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
jest.mock('../../channel-providers/meta-channel.entity', () => ({ findByPk: jest.fn(), findOne: jest.fn() }));
jest.mock('../customer.entity', () => ({ findByPk: jest.fn() }));

const axios = require('axios');
const MetaChannel = require('../../channel-providers/meta-channel.entity');
const Customer = require('../customer.entity');
const { enrichCustomerNameFromMeta, isPlaceholderName } = require('../customer-profile.service');

const makeCustomer = (overrides = {}) => ({
    id: 'cust-1',
    name: 'Customer',
    metadata: {},
    update: jest.fn().mockResolvedValue(true),
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    MetaChannel.findByPk.mockResolvedValue({ page_access_token_ct: 'page-token' });
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
    test('replaces the placeholder with first+last name and stores profile pic', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { first_name: 'Evan', last_name: 'Ahmed', profile_pic: 'https://pic/x.jpg' } });

        const updated = await enrichCustomerNameFromMeta({
            customerId: 'cust-1', metaChannelId: 'mc-1', psid: 'fb-psid-9',
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

        await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', psid: 'ig-1' });

        expect(customer.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rahim Uddin' }));
    });

    test('does not overwrite a real name', async () => {
        const customer = makeCustomer({
            name: 'Already Real',
            metadata: { first_name: 'Already', last_name: 'Real', profile_pic: 'https://pic/existing.jpg' },
        });
        Customer.findByPk.mockResolvedValue(customer);

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', psid: 'p' });

        expect(updated).toBe(false);
        expect(axios.get).not.toHaveBeenCalled();
        expect(customer.update).not.toHaveBeenCalled();
    });

    test('fills missing profile metadata without overwriting a real name', async () => {
        const customer = makeCustomer({ name: 'Already Real', metadata: {} });
        Customer.findByPk.mockResolvedValue(customer);
        axios.get.mockResolvedValue({ data: { first_name: 'Meta', last_name: 'Person', profile_pic: 'https://pic/meta.jpg' } });

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', psid: 'p' });

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
            enrichCustomerNameFromMeta({ customerId: 'cust-1', metaChannelId: 'mc-1', psid: 'p' })
        ).resolves.toBe(false);
        expect(customer.update).not.toHaveBeenCalled();
    });

    test('skips when no channel/token can be resolved', async () => {
        Customer.findByPk.mockResolvedValue(makeCustomer());
        MetaChannel.findByPk.mockResolvedValue(null);
        MetaChannel.findOne.mockResolvedValue(null);

        const updated = await enrichCustomerNameFromMeta({ customerId: 'cust-1', psid: 'p', shopId: 's', platform: 'messenger' });

        expect(updated).toBe(false);
        expect(axios.get).not.toHaveBeenCalled();
    });
});
