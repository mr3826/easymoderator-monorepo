/**
 * meta-oauth.controller.test.js
 *
 * Verifies the canonical OAuth controller forwards req.body / req.user shape
 * correctly to the underlying oauthService and wraps the response in the
 * standard { success, data } envelope.
 *
 * These are pure contract tests — we mock the service layer so they don't
 * need a database, Redis, or live Meta credentials.
 */

'use strict';

process.env.NODE_ENV = 'test';

jest.mock('src/modules/channel-providers/meta-oauth.service', () => ({
    initiateOAuth: jest.fn(),
    handleCallback: jest.fn(),
    connectPage: jest.fn(),
}));

const oauthService = require('src/modules/channel-providers/meta-oauth.service');
const controller = require('src/modules/channel-providers/meta-oauth.controller');

function mkRes() {
    const res = {};
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('meta-oauth.controller', () => {
    describe('initiate', () => {
        test('forwards (userId, shopId, platform) and returns redirectUrl/state', async () => {
            oauthService.initiateOAuth.mockResolvedValue({ redirectUrl: 'https://x', state: 'st' });
            const req = { user: { userId: 'u1', shopId: 's1' }, body: { platform: 'facebook' } };
            const res = mkRes();
            const next = jest.fn();

            await controller.initiate(req, res, next);

            expect(oauthService.initiateOAuth).toHaveBeenCalledWith('u1', 's1', 'facebook');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { redirectUrl: 'https://x', state: 'st' },
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('forwards errors to next()', async () => {
            const err = new Error('boom');
            oauthService.initiateOAuth.mockRejectedValue(err);
            const req = { user: { userId: 'u1', shopId: 's1' }, body: { platform: 'instagram' } };
            const res = mkRes();
            const next = jest.fn();

            await controller.initiate(req, res, next);

            expect(next).toHaveBeenCalledWith(err);
            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('callback', () => {
        test('forwards (code, state, userId, shopId) and returns pages/tempToken', async () => {
            oauthService.handleCallback.mockResolvedValue({ pages: [{ id: 'P1' }], tempToken: 'tt' });
            const req = {
                user: { userId: 'u1', shopId: 's1' },
                body: { code: 'abcdefghij', state: 'x'.repeat(64) },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.callback(req, res, next);

            expect(oauthService.handleCallback).toHaveBeenCalledWith(
                'abcdefghij',
                'x'.repeat(64),
                'u1',
                's1'
            );
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { pages: [{ id: 'P1' }], tempToken: 'tt' },
            });
        });
    });

    describe('connectAsset', () => {
        test('forwards (assetId, displayName, tempToken, userId, shopId) → connectPage', async () => {
            oauthService.connectPage.mockResolvedValue({
                id: 'ch-1', webhookWarning: null, webhookSubscribed: true,
            });
            const req = {
                user: { userId: 'u1', shopId: 's1' },
                body: { assetId: 'PAGE_42', displayName: 'My Page', tempToken: 't'.repeat(64) },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.connectAsset(req, res, next);

            expect(oauthService.connectPage).toHaveBeenCalledWith(
                'PAGE_42',
                'My Page',
                't'.repeat(64),
                'u1',
                's1'
            );
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { id: 'ch-1', webhookWarning: null, webhookSubscribed: true },
            });
        });
    });
});
