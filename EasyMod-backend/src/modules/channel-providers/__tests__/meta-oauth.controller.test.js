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
    initiateUnifiedOAuth: jest.fn(),
    handleUnifiedCallback: jest.fn(),
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
        test('forwards (assetId, displayName, tempToken, userId, shopId, platform) → connectPage', async () => {
            oauthService.connectPage.mockResolvedValue({
                id: 'ch-1', webhookWarning: null, webhookSubscribed: true,
            });
            const req = {
                user: { userId: 'u1', shopId: 's1' },
                body: {
                    assetId: 'PAGE_42',
                    displayName: 'My Page',
                    tempToken: 't'.repeat(64),
                    platform: 'facebook',
                },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.connectAsset(req, res, next);

            expect(oauthService.connectPage).toHaveBeenCalledWith(
                'PAGE_42',
                'My Page',
                't'.repeat(64),
                'u1',
                's1',
                'facebook'
            );
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { id: 'ch-1', webhookWarning: null, webhookSubscribed: true },
            });
        });
    });

    // ── Unified OAuth handlers ─────────────────────────────────────────────

    describe('initiateUnified', () => {
        test('forwards (userId, shopId) and returns redirectUrl/state', async () => {
            oauthService.initiateUnifiedOAuth.mockResolvedValue({
                redirectUrl: 'https://facebook.com/dialog/oauth?...',
                state: 'unified:s1:u1:abc123',
            });
            const req = { user: { userId: 'u1', shopId: 's1' }, body: {} };
            const res = mkRes();
            const next = jest.fn();

            await controller.initiateUnified(req, res, next);

            expect(oauthService.initiateUnifiedOAuth).toHaveBeenCalledWith('u1', 's1');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: { redirectUrl: 'https://facebook.com/dialog/oauth?...', state: 'unified:s1:u1:abc123' },
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('forwards errors to next()', async () => {
            const err = new Error('config missing');
            oauthService.initiateUnifiedOAuth.mockRejectedValue(err);
            const req = { user: { userId: 'u1', shopId: 's1' }, body: {} };
            const res = mkRes();
            const next = jest.fn();

            await controller.initiateUnified(req, res, next);

            expect(next).toHaveBeenCalledWith(err);
            expect(res.json).not.toHaveBeenCalled();
        });
    });

    describe('callbackUnified', () => {
        test('returns facebookPages + instagramAccounts + tempToken', async () => {
            const mockResult = {
                facebookPages: [{ id: 'P1', name: 'My Store', platform: 'facebook' }],
                instagramAccounts: [{ id: 'IG1', name: 'My Store IG', platform: 'instagram' }],
                tempToken: 'user_token_xyz',
            };
            oauthService.handleUnifiedCallback.mockResolvedValue(mockResult);
            const req = {
                user: { userId: 'u1', shopId: 's1' },
                body: { code: 'code_abc123', state: 'unified:s1:u1:' + 'a'.repeat(32) },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.callbackUnified(req, res, next);

            expect(oauthService.handleUnifiedCallback).toHaveBeenCalledWith(
                'code_abc123',
                'unified:s1:u1:' + 'a'.repeat(32),
                'u1',
                's1'
            );
            expect(res.json).toHaveBeenCalledWith({ success: true, data: mockResult });
            expect(next).not.toHaveBeenCalled();
        });

        test('response shape includes both platform arrays even when empty', async () => {
            oauthService.handleUnifiedCallback.mockResolvedValue({
                facebookPages: [],
                instagramAccounts: [],
                tempToken: 'token_no_pages',
            });
            const req = {
                user: { userId: 'u2', shopId: 's2' },
                body: { code: 'code_empty', state: 'unified:s2:u2:' + 'b'.repeat(32) },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.callbackUnified(req, res, next);

            const call = res.json.mock.calls[0][0];
            expect(call.data).toHaveProperty('facebookPages');
            expect(call.data).toHaveProperty('instagramAccounts');
            expect(call.data).toHaveProperty('tempToken');
            expect(Array.isArray(call.data.facebookPages)).toBe(true);
            expect(Array.isArray(call.data.instagramAccounts)).toBe(true);
        });

        test('forwards errors to next()', async () => {
            const err = Object.assign(new Error('Invalid state'), { status: 400 });
            oauthService.handleUnifiedCallback.mockRejectedValue(err);
            const req = {
                user: { userId: 'u1', shopId: 's1' },
                body: { code: 'bad_code', state: 'unified:s1:u1:' + 'c'.repeat(32) },
            };
            const res = mkRes();
            const next = jest.fn();

            await controller.callbackUnified(req, res, next);

            expect(next).toHaveBeenCalledWith(err);
            expect(res.json).not.toHaveBeenCalled();
        });
    });
});
