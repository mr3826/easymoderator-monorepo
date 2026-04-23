/**
 * Shop Service — Unit Tests
 * Tests getShopsByUserId, getShopById, createShop, updateShopById,
 * deleteShopById, and settings deep-merge behaviour
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockShop = {
    id: 'shop-1',
    shop_name: 'My BD Shop',
    name: 'My BD Shop',
    unique_code: 'SHOP1',
    settings: { businessInfo: { shopName: 'My BD Shop' }, aiEnabled: true },
    toJSON: function () { return { id: this.id, shop_name: this.shop_name, name: this.name, unique_code: this.unique_code, settings: this.settings }; },
    update: jest.fn().mockResolvedValue(true),
};

jest.mock('../../entities', () => ({
    User: { findByPk: jest.fn() },
    Shop: {
        findByPk: jest.fn(),
        create: jest.fn(),
        destroy: jest.fn(),
    },
    UserShop: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        destroy: jest.fn(),
    },
    Tenant: { findByPk: jest.fn() },
}));

jest.mock('../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        })
    }
}));

jest.mock('./shop-defaults', () => ({
    DEFAULT_AI_SETTINGS: { primary_provider: 'gemini', fallback_provider: 'openai' }
}));

jest.mock('./shop-settings.validator', () => ({
    validateAISettings: jest.fn().mockReturnValue({ valid: true }),
    validateSettings: jest.fn().mockReturnValue({ valid: true }),
    sanitizeSettings: jest.fn((s) => s),
}));

const { Shop, UserShop } = require('../../entities');
const shopService = require('src/modules/shop/shop.service');

// ── Test Data ─────────────────────────────────────────────────────────────────
const mockUserShop = {
    user_id: 'user-1',
    shop_id: 'shop-1',
    role: 'owner',
    is_active: true,
    shop: mockShop,
    toJSON: () => ({ user_id: 'user-1', shop_id: 'shop-1', role: 'owner' }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Shop Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Shop.findByPk.mockResolvedValue({ ...mockShop, update: jest.fn().mockResolvedValue(true) });
        Shop.create.mockResolvedValue({ ...mockShop, toJSON: mockShop.toJSON });
        Shop.destroy.mockResolvedValue(1);
        UserShop.findOne.mockResolvedValue({ ...mockUserShop });
        UserShop.findAll.mockResolvedValue([{ ...mockUserShop }]);
        UserShop.create.mockResolvedValue({ id: 'us-1' });
    });

    // ── getShopsByUserId ───────────────────────────────────────────────────────

    it('getShopsByUserId — returns shops with role for a user', async () => {
        const result = await shopService.getShopsByUserId('user-1');
        expect(UserShop.findAll).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ user_id: 'user-1', is_active: true }) })
        );
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].role).toBe('owner');
    });

    it('getShopsByUserId — returns empty array when user has no shops', async () => {
        UserShop.findAll.mockResolvedValueOnce([]);
        const result = await shopService.getShopsByUserId('user-new');
        expect(result).toEqual([]);
    });

    // ── getShopById ────────────────────────────────────────────────────────────

    it('getShopById — returns shop with role when access is valid', async () => {
        const result = await shopService.getShopById('shop-1', 'user-1');
        expect(UserShop.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ shop_id: 'shop-1', user_id: 'user-1' }) })
        );
        expect(result.role).toBe('owner');
    });

    it('getShopById — throws 404 when user has no access', async () => {
        UserShop.findOne.mockResolvedValueOnce(null);
        await expect(shopService.getShopById('shop-1', 'user-x'))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    // ── createShop ─────────────────────────────────────────────────────────────

    it('createShop — creates shop and UserShop within transaction', async () => {
        const result = await shopService.createShop('user-1', { shop_name: 'New Shop' });
        expect(Shop.create).toHaveBeenCalled();
        expect(UserShop.create).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-1', role: 'owner' }),
            expect.anything()
        );
        expect(result.role).toBe('owner');
    });

    it('createShop — uses shop_name as name when name is missing', async () => {
        await shopService.createShop('user-1', { shop_name: 'BD Fashion' });
        expect(Shop.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'BD Fashion', shop_name: 'BD Fashion' }),
            expect.anything()
        );
    });

    it('createShop — defaults name to "My Shop" when neither name nor shop_name given', async () => {
        await shopService.createShop('user-1', {});
        expect(Shop.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'My Shop' }),
            expect.anything()
        );
    });

    // ── updateShopById ─────────────────────────────────────────────────────────

    it('updateShopById — throws 404 when user has no access', async () => {
        UserShop.findOne.mockResolvedValueOnce(null);
        await expect(shopService.updateShopById('shop-1', 'user-x', { shop_name: 'New Name' }))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('updateShopById — deep-merges settings instead of replacing', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { aiEnabled: true, paymentMethods: ['bkash'] },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await shopService.updateShopById('shop-1', 'user-1', {
            settings: { newSetting: 'value' }
        });

        expect(shopWithSettings.update).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: expect.objectContaining({
                    aiEnabled: true,
                    paymentMethods: ['bkash'],
                    newSetting: 'value',
                })
            })
        );
    });

    it('updateShopById — syncs settings.businessInfo.shopName when shop_name changes', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { businessInfo: { shopName: 'Old Name' } },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await shopService.updateShopById('shop-1', 'user-1', { shop_name: 'New Name' });

        expect(shopWithSettings.update).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: expect.objectContaining({
                    businessInfo: expect.objectContaining({ shopName: 'New Name' })
                })
            })
        );
    });

    it('updateShopById — does not allow updating id or unique_code', async () => {
        const shopInstance = {
            ...mockShop,
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopInstance);

        await shopService.updateShopById('shop-1', 'user-1', { id: 'hacked-id', shop_name: 'Valid' });

        expect(shopInstance.update).toHaveBeenCalledWith(
            expect.not.objectContaining({ id: 'hacked-id' })
        );
    });

    // ── deleteShopById ─────────────────────────────────────────────────────────

    it('deleteShopById — deletes shop when user is owner', async () => {
        UserShop.findOne.mockResolvedValueOnce({ ...mockUserShop, role: 'owner' });
        const result = await shopService.deleteShopById('shop-1', 'user-1');
        expect(Shop.destroy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shop-1' } }));
        expect(result.message).toBeDefined();
    });

    it('deleteShopById — throws 403 when user is not owner', async () => {
        UserShop.findOne.mockResolvedValueOnce(null); // owner check fails
        await expect(shopService.deleteShopById('shop-1', 'user-staff'))
            .rejects.toMatchObject({ statusCode: 403 });
    });
});
