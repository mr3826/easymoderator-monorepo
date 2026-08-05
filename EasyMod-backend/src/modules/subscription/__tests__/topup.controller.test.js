'use strict';

process.env.APP_URL = 'https://app.easymod.tech';

jest.mock('../../entities', () => ({
    User: { findByPk: jest.fn() },
    Shop: { findByPk: jest.fn() }
}));

jest.mock('../topup.service', () => ({
    getTopupPacks: jest.fn(),
    initiateTopup: jest.fn(),
    completeTopup: jest.fn(),
    getTopupHistory: jest.fn()
}));

const { User, Shop } = require('../../entities');
const topupService = require('../topup.service');
const topupController = require('../topup.controller');

const makeReq = (body = {}) => ({
    user: { userId: 'user-1', shopId: 'shop-1' },
    body
});

const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});

beforeEach(() => {
    jest.clearAllMocks();
    topupService.initiateTopup.mockResolvedValue({
        topup_id: 'topup-1',
        bkash_url: 'https://bkash.example/pay',
        payment_id: 'pay-1'
    });
});

describe('topupController.initiateTopup', () => {
    it('uses authenticated user contact when the browser omits payment phone/name', async () => {
        User.findByPk.mockResolvedValueOnce({ full_name: 'Founder Owner', phone: '01711111111' });
        Shop.findByPk.mockResolvedValueOnce({
            shop_name: 'Founder Shop',
            name: 'Founder Shop',
            settings: { businessInfo: { phone: '01722222222', shopName: 'Business Shop' } }
        });
        const req = makeReq({ pack_code: 'TOPUP_100', callback_url: 'https://attacker.example/steal' });
        const res = makeRes();
        const next = jest.fn();

        await topupController.initiateTopup(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(topupService.initiateTopup).toHaveBeenCalledWith('shop-1', 'TOPUP_100', {
            phone: '01711111111',
            name: 'Founder Owner',
            callbackUrl: 'https://app.easymod.tech/app/subscription'
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('falls back to saved shop business info when the user has no phone', async () => {
        User.findByPk.mockResolvedValueOnce({ full_name: null, phone: null });
        Shop.findByPk.mockResolvedValueOnce({
            shop_name: 'Fallback Shop',
            name: 'Fallback Shop',
            settings: { businessInfo: { phone: '01733333333', shopName: 'Saved Business Name' } }
        });
        const req = makeReq({ pack_code: 'TOPUP_250' });
        const res = makeRes();
        const next = jest.fn();

        await topupController.initiateTopup(req, res, next);

        expect(topupService.initiateTopup).toHaveBeenCalledWith('shop-1', 'TOPUP_250', {
            phone: '01733333333',
            name: 'Saved Business Name',
            callbackUrl: 'https://app.easymod.tech/app/subscription'
        });
    });

    it('keeps explicit payment contact fields when supplied by an authenticated user', async () => {
        User.findByPk.mockResolvedValueOnce({ full_name: 'Founder Owner', phone: '01711111111' });
        Shop.findByPk.mockResolvedValueOnce({ shop_name: 'Founder Shop', name: 'Founder Shop', settings: {} });
        const req = makeReq({
            pack_code: 'TOPUP_500',
            callback_url: 'https://attacker.example/steal',
            phone: '01799999999',
            name: 'Billing Contact'
        });
        const res = makeRes();
        const next = jest.fn();

        await topupController.initiateTopup(req, res, next);

        expect(topupService.initiateTopup).toHaveBeenCalledWith('shop-1', 'TOPUP_500', {
            phone: '01799999999',
            name: 'Billing Contact',
            callbackUrl: 'https://app.easymod.tech/app/subscription'
        });
    });
});
