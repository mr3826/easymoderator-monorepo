'use strict';

jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../middleware/platform-admin.middleware', () => ({
    PLATFORM_ROLES: { SUPER_ADMIN: 'SUPER_ADMIN' },
    requirePlatformAdmin: jest.fn(() => jest.fn((_req, _res, next) => next())),
}));
jest.mock('../delivery-rag.controller', () => ({
    initializeCollections: jest.fn(),
    addDeliveryZone: jest.fn(),
    batchAddDeliveryZones: jest.fn(),
    getDeliveryZones: jest.fn(),
    updateDeliveryZone: jest.fn(),
    deleteDeliveryZone: jest.fn(),
    matchAddress: jest.fn(),
    calculateDeliveryCharge: jest.fn(),
    getDeliveryStats: jest.fn(),
    testAddressMatching: jest.fn(),
}));

const {
    _private: { bindAuthenticatedShop },
} = require('../delivery-rag.routes');

function response() {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
}

describe('delivery RAG tenant binding', () => {
    test.each([
        [{ body: { shop_id: 'shop-2' }, params: {}, query: {} }],
        [{ body: {}, params: { shop_id: 'shop-2' }, query: {} }],
        [{ body: {}, params: {}, query: { shop_id: 'shop-2' } }],
    ])('rejects a cross-shop selector from every request location', (request) => {
        const res = response();
        const next = jest.fn();
        bindAuthenticatedShop({
            ...request,
            user: { shopId: 'shop-1' },
        }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('binds an own-shop request and rejects missing token shop context', () => {
        const ownRequest = {
            body: {},
            params: {},
            query: {},
            user: { shopId: 'shop-1' },
        };
        const next = jest.fn();
        bindAuthenticatedShop(ownRequest, response(), next);
        expect(ownRequest.authenticatedShopId).toBe('shop-1');
        expect(next).toHaveBeenCalledTimes(1);

        const res = response();
        bindAuthenticatedShop({ body: {}, params: {}, query: {}, user: {} }, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
