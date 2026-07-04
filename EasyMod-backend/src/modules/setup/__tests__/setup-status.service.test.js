'use strict';

jest.mock('../../entities', () => ({
    MetaChannel: { count: jest.fn() },
    Product: { count: jest.fn() },
    FaqResponse: { count: jest.fn() },
}));

jest.mock('../../shop/shop.service', () => ({
    getShopById: jest.fn(),
    getShopAiSettings: jest.fn(),
}));

const { MetaChannel, Product, FaqResponse } = require('../../entities');
const shopService = require('../../shop/shop.service');
const setupStatusService = require('../setup-status.service');

function mockCounts({
    connectedFacebookPages = 0,
    webhookVerifiedFacebookPages = 0,
    activeProducts = 0,
    activeFaqs = 0,
} = {}) {
    MetaChannel.count
        .mockResolvedValueOnce(connectedFacebookPages)
        .mockResolvedValueOnce(webhookVerifiedFacebookPages);
    Product.count.mockResolvedValueOnce(activeProducts);
    FaqResponse.count.mockResolvedValueOnce(activeFaqs);
}

describe('setup-status.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shopService.getShopAiSettings.mockResolvedValue({
            automation_mode: 'DRAFT',
            confidence_threshold: 75,
            payment_methods: ['COD'],
        });
    });

    it('returns a dashboard setup checklist from shop data without completion flags', async () => {
        shopService.getShopById.mockResolvedValue({
            id: 'shop-1',
            shop_name: 'Starter Shop',
            settings: { businessInfo: {} },
        });
        mockCounts();

        const status = await setupStatusService.getSetupStatus({
            shopId: 'shop-1',
            userId: 'user-1',
        });

        expect(status.isComplete).toBe(false);
        expect(status.completedCount).toBe(1);
        expect(status.tasks).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'connect_channel', status: 'incomplete' }),
            expect.objectContaining({ key: 'shop_profile', status: 'incomplete', missing: ['support_contact', 'delivery_info'] }),
            expect.objectContaining({ key: 'first_product', status: 'incomplete' }),
            expect.objectContaining({ key: 'ai_settings', status: 'complete' }),
            expect.objectContaining({
                key: 'starter_knowledge',
                status: 'incomplete',
                ctaLabel: 'Add FAQ',
                href: '/app/manage-shop/faqs',
            }),
        ]));
        expect(status.counts).toMatchObject({
            connectedFacebookPages: 0,
            activeProducts: 0,
            activeFaqs: 0,
            knowledgeDocuments: 0,
        });
    });

    it('treats connected Facebook pages as complete even when webhook verification is stale', async () => {
        shopService.getShopById.mockResolvedValue({
            id: 'shop-1',
            shop_name: 'Ready Shop',
            settings: {
                businessInfo: {
                    phone: '01700000000',
                    deliveryAreas: ['Dhaka'],
                },
            },
        });
        mockCounts({
            connectedFacebookPages: 1,
            webhookVerifiedFacebookPages: 0,
            activeProducts: 1,
            activeFaqs: 1,
        });

        const status = await setupStatusService.getSetupStatus({
            shopId: 'shop-1',
            userId: 'user-1',
        });

        expect(status.isComplete).toBe(true);
        expect(status.completedCount).toBe(5);
        expect(status.tasks.find((task) => task.key === 'connect_channel')).toMatchObject({
            status: 'complete',
            warnings: [expect.objectContaining({ code: 'WEBHOOK_NOT_VERIFIED' })],
        });
        expect(status.tasks.find((task) => task.key === 'first_product')).toMatchObject({
            status: 'complete',
            warnings: [expect.objectContaining({ code: 'LOW_PRODUCT_COUNT' })],
        });
    });

    it('maps setup status to the legacy onboarding contract', () => {
        const legacy = setupStatusService.toLegacyOnboardingStatus({
            isComplete: false,
            counts: {
                connectedFacebookPages: 1,
                activeProducts: 1,
                activeFaqs: 0,
            },
            tasks: [
                { key: 'connect_channel', status: 'complete' },
                { key: 'shop_profile', status: 'complete' },
                { key: 'first_product', status: 'complete' },
                { key: 'ai_settings', status: 'complete' },
                { key: 'starter_knowledge', status: 'incomplete' },
            ],
        });

        expect(legacy.completed).toBe(false);
        expect(legacy.can_complete).toBe(false);
        expect(legacy.checks).toMatchObject({
            facebook_connected: true,
            business_info_added: true,
            knowledge_added: false,
            assistant_test_completed: true,
        });
        expect(legacy.missing).toEqual(['starter_knowledge']);
    });
});
