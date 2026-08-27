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
const { serializeChannel } = require('../meta-channel.serializer');

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
            const req = { user: { userId: 'u1', shopId: 's1' }, body: { platform: 'facebook' } };
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
                id: 'ch-1',
                webhookWarning: null,
                webhookSubscribed: true,
                page_access_token_ct: 'page-secret-token',
                access_token: 'oauth-user-token',
                pageAccessToken: 'page-secret-alias',
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
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    id: 'ch-1',
                    webhookWarning: null,
                    webhookSubscribed: true,
                }),
            }));

            const responseData = res.json.mock.calls[0][0].data;
            expect(responseData).not.toHaveProperty('page_access_token_ct');
            expect(responseData).not.toHaveProperty('access_token');
            expect(responseData).not.toHaveProperty('pageAccessToken');
        });
    });

    test('the shared serializer excludes token and credential fields from toJSON output', () => {
        const serialized = serializeChannel({
            toJSON: () => ({
                id: 'channel-1',
                shop_id: 'shop-1',
                page_access_token_ct: 'secret-page-token',
                access_token: 'secret-oauth-token',
                credentials: { app_secret: 'secret' },
                settings: { purpose_label: 'Sales' },
            }),
        }, { webhookWarning: null });

        expect(serialized).toEqual(expect.objectContaining({
            id: 'channel-1',
            shopId: 'shop-1',
            purposeLabel: 'Sales',
            webhookWarning: null,
        }));
        expect(serialized).not.toHaveProperty('page_access_token_ct');
        expect(serialized).not.toHaveProperty('access_token');
        expect(serialized).not.toHaveProperty('credentials');
    });

    test('Meta settings PATCH rejects a foreign channel before the service mutation', async () => {
        const channelModel = { findByPk: jest.fn().mockResolvedValue({ id: 'channel-1', shop_id: 'shop-2' }) };
        const channelService = { updateSettings: jest.fn(), getSettings: jest.fn() };

        await jest.isolateModulesAsync(async () => {
            jest.doMock('../meta-channel.entity', () => channelModel);
            jest.doMock('../meta-channel.service', () => channelService);
            jest.doMock('../meta-channel-settings.entity', () => ({ findOne: jest.fn() }));
            jest.doMock('../meta-channel-consent-event.entity', () => ({ count: jest.fn(), findAll: jest.fn() }));
            jest.doMock('../provider.registry', () => ({ getProvider: jest.fn() }));

            const channelController = require('../meta-channel.controller');
            const next = jest.fn();
            await channelController.updateChannelSettings({
                params: { channelId: 'channel-1' },
                user: { shopId: 'shop-1' },
                body: { aiAutoReply: false },
            }, mkRes(), next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
            expect(channelService.updateSettings).not.toHaveBeenCalled();
        });
    });
});
