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
    Subscription: { create: jest.fn() },
    Tenant: { findByPk: jest.fn() },
    PushSubscription: { destroy: jest.fn() },
}));

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (cb) => {
            const t = { commit: jest.fn(), rollback: jest.fn() };
            if (typeof cb === 'function') return cb(t);
            return t;
        })
    }
}));

jest.mock('../shop-defaults', () => ({
    DEFAULT_AI_SETTINGS: { primary_provider: 'gemini', fallback_provider: 'openai' }
}));

jest.mock('../shop-settings.validator', () => ({
    validateAISettings: jest.fn().mockReturnValue({ valid: true }),
    validateSettings: jest.fn().mockReturnValue({ valid: true }),
    sanitizeSettings: jest.fn(jest.requireActual('../shop-settings.validator').sanitizeSettings),
    mergeAndSanitizeSettings: jest.fn((current, patch) => (
        jest.requireActual('../shop-settings.validator').mergeAndSanitizeSettings(current, patch)
    )),
    stripAutomationModeFromShopUpdate: jest.fn((updateData) => (
        jest.requireActual('../shop-settings.validator').stripAutomationModeFromShopUpdate(updateData)
    )),
}));

jest.mock('../../audit/audit.service', () => ({
    logOperation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../utils/sse-manager', () => ({
    emit: jest.fn(),
}));

const { Shop, UserShop, Subscription, PushSubscription } = require('../../entities');
const shopService = require('src/modules/shop/shop.service');
const auditService = require('../../audit/audit.service');
const sseManager = require('../../../utils/sse-manager');

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
        PushSubscription.destroy.mockResolvedValue(0);
    });

    // ── getShopsByUserId ───────────────────────────────────────────────────────

    // One shop per account: getShopsByUserId delegates to getMyShop, which reads
    // UserShop.findOne and wraps the result in an array. It never calls findAll,
    // so both of these were asserting against a query the service stopped making.
    it('getShopsByUserId — returns the shop for a user with their role', async () => {
        const result = await shopService.getShopsByUserId('user-1');
        expect(UserShop.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ user_id: 'user-1', is_active: true }) })
        );
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].role).toBe('owner');
    });

    it('getShopsByUserId — returns empty array when user has no shops', async () => {
        UserShop.findOne.mockResolvedValueOnce(null);
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
            .rejects.toMatchObject({ status: 404 });
    });

    // ── createShop ─────────────────────────────────────────────────────────────

    // createShop 409s when the account already has a shop, and the shared
    // beforeEach gives every test one.
    describe('createShop', () => {
    beforeEach(() => {
        UserShop.findOne.mockResolvedValue(null);
    });

    it('createShop — creates shop and UserShop within transaction', async () => {
        const result = await shopService.createShop('user-1', { shop_name: 'New Shop' });
        expect(Shop.create).toHaveBeenCalled();
        expect(UserShop.create).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-1', role: 'owner' }),
            expect.anything()
        );
        expect(Subscription.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: 'shop-1', plan_code: 'SHURU', conversations_limit: 100 }),
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

    it('createShop — refuses a second shop for the same account', async () => {
        UserShop.findOne.mockResolvedValue({ id: 'us-1', shop_id: 'shop-1' });
        await expect(shopService.createShop('user-1', { shop_name: 'Second Shop' }))
            .rejects.toMatchObject({ status: 409 });
        expect(Shop.create).not.toHaveBeenCalled();
    });
    });

    // ── updateShopById ─────────────────────────────────────────────────────────

    it('updateShopById — throws 404 when user has no access', async () => {
        UserShop.findOne.mockResolvedValueOnce(null);
        await expect(shopService.updateShopById('shop-1', 'user-x', { shop_name: 'New Name' }))
            .rejects.toMatchObject({ status: 404 });
    });

    it('updateShopById — preserves known settings and drops new arbitrary top-level keys', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { aiEnabled: true, paymentMethods: ['bkash'] },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await shopService.updateShopById('shop-1', 'user-1', {
            settings: { newSetting: 'value', delivery: { default_delivery_charge: 80 } }
        });

        expect(shopWithSettings.update).toHaveBeenCalledWith(
            expect.objectContaining({
                settings: expect.objectContaining({
                    aiEnabled: true,
                    paymentMethods: ['bkash'],
                    delivery: { default_delivery_charge: 80 },
                })
            })
        );
        expect(shopWithSettings.update.mock.calls[0][0].settings).not.toHaveProperty('newSetting');
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

    it('updateShopById — strips the reply mode from the general settings update', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { ai: { automation_mode: 'DRAFT' } },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await shopService.updateShopById('shop-1', 'user-1', {
            settings: { ai: { automation_mode: 'AUTO' } },
        });

        expect(shopWithSettings.update).toHaveBeenCalledWith(expect.objectContaining({
            settings: expect.objectContaining({
                ai: { automation_mode: 'DRAFT' },
            }),
        }));
    });

    it('getShopAiSettings — normalizes legacy aliases on read', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { ai: { automation_mode: 'AI_SUGGEST_ONLY' } },
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await expect(shopService.getShopAiSettings('shop-1')).resolves.toEqual(expect.objectContaining({
            automation_mode: 'DRAFT',
        }));
    });

    it('updateShopAiSettings — persists canonical mode and emits audit plus SSE', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { ai: { automation_mode: 'DRAFT' } },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        const result = await shopService.updateShopAiSettings('shop-1', 'user-1', {
            automation_mode: 'AI_ACTIVE',
        });

        expect(result.automation_mode).toBe('AUTO');
        expect(shopWithSettings.update).toHaveBeenCalledWith(expect.objectContaining({
            settings: expect.objectContaining({
                ai: expect.objectContaining({ automation_mode: 'AUTO', auto_reply_enabled: true }),
            }),
        }));
        expect(auditService.logOperation).toHaveBeenCalledWith(expect.objectContaining({
            action: 'AI_REPLY_MODE_CHANGED',
            shopId: 'shop-1',
            userId: 'user-1',
            oldValues: { automation_mode: 'DRAFT' },
            newValues: { automation_mode: 'AUTO' },
            metadata: {
                shop_id: 'shop-1',
                old_mode: 'DRAFT',
                new_mode: 'AUTO',
                actor_id: 'user-1',
            },
        }));
        expect(sseManager.emit).toHaveBeenCalledWith('shop-1', 'ai_reply_mode_changed', { mode: 'AUTO' });
    });

    it('updateShopAiSettings — does not emit for a normalized no-op', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { ai: { automation_mode: 'AI_ACTIVE' } },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        await shopService.updateShopAiSettings('shop-1', 'user-1', { automation_mode: 'AUTO' });

        expect(auditService.logOperation).not.toHaveBeenCalled();
        expect(sseManager.emit).not.toHaveBeenCalled();
    });

    it('updateShopAiSettings — cannot make the legacy boolean override Manual mode', async () => {
        const shopWithSettings = {
            ...mockShop,
            settings: { ai: { automation_mode: 'MANUAL', auto_reply_enabled: false } },
            update: jest.fn().mockResolvedValue(true),
        };
        Shop.findByPk.mockResolvedValueOnce(shopWithSettings);

        const result = await shopService.updateShopAiSettings('shop-1', 'user-1', {
            auto_reply_enabled: true,
        });

        expect(result).toEqual(expect.objectContaining({
            automation_mode: 'MANUAL',
            auto_reply_enabled: false,
        }));
        expect(shopWithSettings.update).toHaveBeenCalledWith(expect.objectContaining({
            settings: expect.objectContaining({
                ai: expect.objectContaining({ automation_mode: 'MANUAL', auto_reply_enabled: false }),
            }),
        }));
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
            .rejects.toMatchObject({ status: 403 });
    });

    // ── removeUserFromShop ─────────────────────────────────────────────────────
    // Defect: removing a user only ever deactivated their UserShop row. Their
    // push_subscriptions rows for the shop were left standing, so a fired or
    // reassigned staff member kept receiving order/customer push notifications
    // indefinitely. Removal must also revoke push delivery for that shop.
    describe('removeUserFromShop', () => {
        const requesterOwner = { user_id: 'user-1', shop_id: 'shop-1', role: 'owner', is_active: true };
        let targetStaff;

        beforeEach(() => {
            targetStaff = {
                user_id: 'user-2',
                shop_id: 'shop-1',
                role: 'staff',
                is_active: true,
                update: jest.fn().mockResolvedValue(true),
            };
            UserShop.findOne.mockReset();
            UserShop.findOne
                .mockResolvedValueOnce(requesterOwner) // requester permission check
                .mockResolvedValueOnce(targetStaff);   // target membership lookup
        });

        it("deactivates membership and deletes the removed user's push subscriptions for this shop", async () => {
            const result = await shopService.removeUserFromShop('shop-1', 'user-1', 'user-2');

            expect(targetStaff.update).toHaveBeenCalledWith(
                { is_active: false },
                expect.anything()
            );
            expect(PushSubscription.destroy).toHaveBeenCalledWith(
                expect.objectContaining({ where: { shop_id: 'shop-1', user_id: 'user-2' } })
            );
            expect(result.message).toBeDefined();
        });

        it('throws 403 when the requester is not an owner or admin, and never touches push subscriptions', async () => {
            UserShop.findOne.mockReset();
            UserShop.findOne
                .mockResolvedValueOnce({ ...requesterOwner, role: 'staff' })
                .mockResolvedValueOnce(targetStaff);

            await expect(shopService.removeUserFromShop('shop-1', 'user-1', 'user-2'))
                .rejects.toMatchObject({ status: 403 });
            expect(PushSubscription.destroy).not.toHaveBeenCalled();
        });

        it('throws 400 and never touches push subscriptions when the target is the owner', async () => {
            UserShop.findOne.mockReset();
            UserShop.findOne
                .mockResolvedValueOnce(requesterOwner)
                .mockResolvedValueOnce({ ...targetStaff, role: 'owner' });

            await expect(shopService.removeUserFromShop('shop-1', 'user-1', 'user-2'))
                .rejects.toMatchObject({ status: 400 });
            expect(PushSubscription.destroy).not.toHaveBeenCalled();
        });
    });
});
