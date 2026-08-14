'use strict';

jest.mock('../../modules/shop/shop.service', () => ({}));
jest.mock('../../modules/entities', () => ({
    Shop: {},
    User: {},
    UserShop: { findAll: jest.fn() },
}));
jest.mock('../../modules/knowledge/knowledge.service', () => ({}));
jest.mock('../../modules/setup/setup-status.service', () => ({}));
jest.mock('../../utils/cache.service', () => ({}));
jest.mock('../../modules/shop/shop-bd-settings', () => ({
    getBdSettings: jest.fn(),
    updateBdSettings: jest.fn(),
}));

const { getShopAgents } = require('../../modules/shop/shop.controller');
const { UserShop } = require('../../modules/entities');

describe('shop agent tenant scope', () => {
    beforeEach(() => jest.clearAllMocks());

    it('uses the verified token shop even when X-Shop-ID is supplied', async () => {
        UserShop.findAll.mockResolvedValue([
            { user: { id: 'user-1', full_name: 'Owner', email: 'owner@example.test' }, role: 'owner' },
        ]);

        const req = {
            user: { userId: 'user-1', shopId: 'shop-1' },
            headers: { 'x-shop-id': 'other-shop' },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await getShopAgents(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(UserShop.findAll).toHaveBeenCalledWith(expect.objectContaining({
            where: { shop_id: 'shop-1', is_active: true },
        }));
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: [{ id: 'user-1', name: 'Owner', email: 'owner@example.test', role: 'owner' }],
        });
    });
});
