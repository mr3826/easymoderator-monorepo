'use strict';

/**
 * Top-Up Controller
 *
 * Endpoints:
 *   GET  /subscription/topup/packs       — list available packs
 *   POST /subscription/topup/initiate    — start BKash payment for a pack
 *   POST /subscription/topup/complete    — verify payment and credit conversations
 *   GET  /subscription/topup/history     — paginated top-up history
 */

const topupService = require('./topup.service');
const { AppError } = require('../../utils/AppError');
const { User, Shop } = require('../entities');
const { getOrigins, joinOrigin } = require('../../config/origins');

const readBusinessInfo = (shop) => {
    const settings = shop?.settings || {};
    return settings.businessInfo || settings.business_info || {};
};

const resolvePaymentContact = async (req, { phone, name }) => {
    const [user, shop] = await Promise.all([
        req.user?.userId ? User.findByPk(req.user.userId, { attributes: ['full_name', 'phone'] }) : null,
        req.user?.shopId ? Shop.findByPk(req.user.shopId, { attributes: ['name', 'shop_name', 'settings'] }) : null
    ]);
    const businessInfo = readBusinessInfo(shop);

    return {
        phone: phone || user?.phone || businessInfo.phone || null,
        name: name || user?.full_name || businessInfo.shopName || businessInfo.shop_name || shop?.shop_name || shop?.name || 'Shop Owner'
    };
};

const getPacks = async (req, res, next) => {
    try {
        res.json({ success: true, data: topupService.getTopupPacks() });
    } catch (err) { next(err); }
};

const initiateTopup = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        const { pack_code, phone, name } = req.body;

        if (!pack_code) throw new AppError('pack_code is required', 400);
        const contact = await resolvePaymentContact(req, { phone, name });

        const result = await topupService.initiateTopup(shopId, pack_code, {
            phone: contact.phone,
            name: contact.name,
            callbackUrl: joinOrigin(getOrigins().app, '/app/subscription')
        });

        res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
};

const completeTopup = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        const { topup_id, payment_id } = req.body;

        if (!topup_id || !payment_id) throw new AppError('topup_id and payment_id are required', 400);

        const result = await topupService.completeTopup(shopId, topup_id, payment_id);
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

const getHistory = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;
        const data = await topupService.getTopupHistory(shopId, limit, offset);
        res.json({ success: true, data });
    } catch (err) { next(err); }
};

module.exports = { getPacks, initiateTopup, completeTopup, getHistory };
