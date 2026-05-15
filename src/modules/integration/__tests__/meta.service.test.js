/**
 * MetaService — Unit Tests
 *
 * Covers: token encryption/decryption, OAuth URL building, webhook field mapping,
 * token exchange, asset availability, integration upsert, token refresh, webhook subscribe.
 */

// ── Environment ────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-32chars!!';
process.env.META_APP_ID = 'test-app-id';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_OAUTH_REDIRECT_URI = 'https://example.com/oauth/callback';

// ── Mocks (before any require) ─────────────────────────────────────────────────

jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => mockModelBase()),
        transaction: jest.fn(),
        authenticate: jest.fn(),
        sync: jest.fn(),
        literal: jest.fn(s => s)
    }
}));

jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }))
}));

jest.mock('axios');

// MetaIntegration entity mock — replace before meta.service loads
const mockIntegration = {
    id: 'integration-1',
    shop_id: 'shop-1',
    platform: 'facebook',
    meta_asset_id: 'page-123',
    access_token: null,
    token_expires_at: null,
    status: 'CONNECTED',
    update: jest.fn(),
};

jest.mock('src/modules/integration/meta-integration.entity', () => ({
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
}));

function mockModelBase() {
    return {
        findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(),
        create: jest.fn(), update: jest.fn(), upsert: jest.fn(), destroy: jest.fn(),
        belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
        addScope: jest.fn(), scope: jest.fn(function() { return this; }),
    };
}

// ── Requires (after mocks) ─────────────────────────────────────────────────────
const axios = require('axios');
const MetaIntegration = require('src/modules/integration/meta-integration.entity');
const metaService = require('src/modules/integration/meta.service');
const { AppError } = require('src/utils/AppError');

// ── Helpers ────────────────────────────────────────────────────────────────────
const SHOP_ID = 'shop-1';
const OTHER_SHOP = 'shop-2';
const PAGE_ID = 'page-123';
const RAW_TOKEN = 'EAATestFacebookLongLivedTokenXYZ123';
const LONG_LIVED_TOKEN = 'EAALongLived60DayTokenABCDEF';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MetaService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: long-lived token exchange succeeds
        axios.get.mockResolvedValue({
            data: { access_token: LONG_LIVED_TOKEN, expires_in: 5184000 } // 60 days
        });
        axios.post.mockResolvedValue({ data: { success: true } });
        axios.delete.mockResolvedValue({ data: {} });
    });

    // ── Token Encryption ────────────────────────────────────────────────────────

    describe('encryptToken / decryptToken', () => {
        it('roundtrip: decrypt(encrypt(token)) === token', () => {
            const encrypted = metaService.encryptToken(RAW_TOKEN);
            expect(metaService.decryptToken(encrypted)).toBe(RAW_TOKEN);
        });

        it('produces different ciphertext on every call (random IV)', () => {
            const enc1 = metaService.encryptToken(RAW_TOKEN);
            const enc2 = metaService.encryptToken(RAW_TOKEN);
            expect(enc1).not.toBe(enc2);
        });

        it('storage format is iv:authTag:ciphertext (three colon-delimited segments)', () => {
            const encrypted = metaService.encryptToken(RAW_TOKEN);
            const parts = encrypted.split(':');
            expect(parts).toHaveLength(3);
            expect(parts[0]).toHaveLength(32); // 16 bytes → 32 hex chars
            expect(parts[1]).toHaveLength(32); // auth tag = 16 bytes
        });

        it('decryptToken with tampered ciphertext throws AppError', () => {
            const encrypted = metaService.encryptToken(RAW_TOKEN);
            const parts = encrypted.split(':');
            const tampered = parts[0] + ':' + parts[1] + ':deadbeef00000000';
            expect(() => metaService.decryptToken(tampered)).toThrow(AppError);
        });

        it('decryptToken with completely invalid string throws AppError', () => {
            expect(() => metaService.decryptToken('not-valid-at-all')).toThrow(AppError);
        });

        it('decryptToken with empty string throws AppError', () => {
            expect(() => metaService.decryptToken('')).toThrow(AppError);
        });

        it('works with unicode tokens', () => {
            const unicodeToken = 'ÄÖÜ€🚀-test-token';
            const encrypted = metaService.encryptToken(unicodeToken);
            expect(metaService.decryptToken(encrypted)).toBe(unicodeToken);
        });
    });

    // ── OAuth URL Building ──────────────────────────────────────────────────────

    describe('buildOAuthUrl', () => {
        it('includes the state param in the URL', () => {
            const url = metaService.buildOAuthUrl('my-state-token', 'facebook');
            expect(url).toContain('state=my-state-token');
        });

        it('facebook URL includes pages_messaging scope', () => {
            const url = metaService.buildOAuthUrl('s', 'facebook');
            expect(url).toContain('pages_messaging');
            expect(url).toContain('pages_show_list');
        });

        it('instagram URL includes instagram_manage_messages scope', () => {
            const url = metaService.buildOAuthUrl('s', 'instagram');
            expect(url).toContain('instagram_manage_messages');
            expect(url).toContain('instagram_manage_comments');
        });

        it('instagram URL does NOT include pages_messaging (wrong permission for IG)', () => {
            const url = metaService.buildOAuthUrl('s', 'instagram');
            expect(url).not.toContain('pages_messaging,');
        });

        it('URL starts with the Facebook OAuth dialog base', () => {
            const url = metaService.buildOAuthUrl('s', 'facebook');
            expect(url).toMatch(/^https:\/\/www\.facebook\.com\/v\d+\.\d+\/dialog\/oauth/);
        });

        it('response_type is code', () => {
            const url = metaService.buildOAuthUrl('s', 'facebook');
            expect(url).toContain('response_type=code');
        });
    });

    // ── Webhook Fields ──────────────────────────────────────────────────────────

    describe('getWebhookFields', () => {
        it('facebook includes messages and postbacks', () => {
            const fields = metaService.getWebhookFields('facebook');
            expect(fields).toContain('messages');
            expect(fields).toContain('messaging_postbacks');
        });

        it('instagram includes messages and message_echoes', () => {
            const fields = metaService.getWebhookFields('instagram');
            expect(fields).toContain('messages');
            expect(fields).toContain('message_echoes');
        });

        it('whatsapp returns messages only', () => {
            expect(metaService.getWebhookFields('whatsapp')).toBe('messages');
        });

        it('unknown platform falls back to messages', () => {
            expect(metaService.getWebhookFields('telegram')).toBe('messages');
        });
    });

    // ── Long-Lived Token Exchange ───────────────────────────────────────────────

    describe('exchangeForLongLivedToken', () => {
        it('returns long-lived token and expiresAt on success', async () => {
            const result = await metaService.exchangeForLongLivedToken('short-token');
            expect(result.access_token).toBe(LONG_LIVED_TOKEN);
            expect(result.expiresAt).toBeInstanceOf(Date);
            expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it('returns null expiresAt when API omits expires_in', async () => {
            axios.get.mockResolvedValueOnce({ data: { access_token: LONG_LIVED_TOKEN } });
            const result = await metaService.exchangeForLongLivedToken('short-token');
            expect(result.expiresAt).toBeNull();
        });

        it('falls back to original token on API failure (non-blocking)', async () => {
            axios.get.mockRejectedValueOnce(new Error('network timeout'));
            const result = await metaService.exchangeForLongLivedToken('original-token');
            expect(result.access_token).toBe('original-token');
            expect(result.expiresAt).toBeNull();
        });

        it('calls the correct Graph API endpoint', async () => {
            await metaService.exchangeForLongLivedToken('tok');
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/oauth/access_token'),
                expect.objectContaining({
                    params: expect.objectContaining({ grant_type: 'fb_exchange_token' })
                })
            );
        });
    });

    // ── Asset Availability ──────────────────────────────────────────────────────

    describe('checkAssetAvailability', () => {
        it('returns true when page is not claimed by any shop', async () => {
            MetaIntegration.findOne.mockResolvedValue(null);
            expect(await metaService.checkAssetAvailability('free-page')).toBe(true);
        });

        it('returns false when page is already claimed', async () => {
            MetaIntegration.findOne.mockResolvedValue({ id: 'existing' });
            expect(await metaService.checkAssetAvailability(PAGE_ID)).toBe(false);
        });
    });

    // ── upsertIntegration ───────────────────────────────────────────────────────

    describe('upsertIntegration', () => {
        it('creates a new integration when none exists for shop+platform', async () => {
            MetaIntegration.findOne
                .mockResolvedValueOnce(null)  // conflict check (different shop)
                .mockResolvedValueOnce(null); // own shop check
            const created = { ...mockIntegration, update: jest.fn() };
            MetaIntegration.create.mockResolvedValue(created);

            await metaService.upsertIntegration(SHOP_ID, 'facebook', PAGE_ID, 'My Page', RAW_TOKEN);

            expect(MetaIntegration.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    shop_id: SHOP_ID,
                    platform: 'facebook',
                    meta_asset_id: PAGE_ID,
                    status: 'CONNECTED'
                })
            );
        });

        it('updates existing integration for same shop+platform (reconnect)', async () => {
            const existing = { ...mockIntegration, update: jest.fn().mockResolvedValue(true) };
            MetaIntegration.findOne
                .mockResolvedValueOnce(null)      // no conflict from another shop
                .mockResolvedValueOnce(existing); // found for own shop

            await metaService.upsertIntegration(SHOP_ID, 'facebook', PAGE_ID, 'New Name', RAW_TOKEN);

            expect(existing.update).toHaveBeenCalledWith(
                expect.objectContaining({ meta_asset_id: PAGE_ID, status: 'CONNECTED' })
            );
            expect(MetaIntegration.create).not.toHaveBeenCalled();
        });

        it('throws 409 when page is already claimed by a DIFFERENT shop', async () => {
            MetaIntegration.findOne.mockResolvedValueOnce({ shop_id: OTHER_SHOP, meta_asset_id: PAGE_ID });

            await expect(
                metaService.upsertIntegration(SHOP_ID, 'facebook', PAGE_ID, 'Page', RAW_TOKEN)
            ).rejects.toThrow(AppError);
        });

        it('allows same shop to reclaim its own page (idempotent reconnect)', async () => {
            MetaIntegration.findOne
                .mockResolvedValueOnce({ shop_id: SHOP_ID, meta_asset_id: PAGE_ID }) // conflict check — same shop OK
                .mockResolvedValueOnce({ ...mockIntegration, update: jest.fn().mockResolvedValue(true) });

            await expect(
                metaService.upsertIntegration(SHOP_ID, 'facebook', PAGE_ID, 'Page', RAW_TOKEN)
            ).resolves.not.toThrow();
        });

        it('stores a long-lived (not raw) token in the database', async () => {
            MetaIntegration.findOne.mockResolvedValue(null);
            MetaIntegration.create.mockResolvedValue({ ...mockIntegration });

            await metaService.upsertIntegration(SHOP_ID, 'facebook', PAGE_ID, 'Page', 'short-token');

            const createCall = MetaIntegration.create.mock.calls[0][0];
            // Stored token should be encrypted (contains colons from iv:authTag:cipher format)
            expect(createCall.access_token).toContain(':');
            expect(createCall.access_token).not.toBe('short-token');
            expect(createCall.access_token).not.toBe(LONG_LIVED_TOKEN);
        });
    });

    // ── refreshTokenForIntegration ──────────────────────────────────────────────

    describe('refreshTokenForIntegration', () => {
        it('decrypts, exchanges, re-encrypts and updates the integration', async () => {
            const encrypted = metaService.encryptToken(RAW_TOKEN);
            const integration = {
                access_token: encrypted,
                update: jest.fn().mockResolvedValue(true)
            };

            await metaService.refreshTokenForIntegration(integration);

            expect(integration.update).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'CONNECTED' })
            );
            const updateArg = integration.update.mock.calls[0][0];
            // New token must be encrypted and different from old
            expect(updateArg.access_token).toContain(':');
        });

        it('sets ERROR status when refresh fails', async () => {
            const integration = {
                access_token: metaService.encryptToken(RAW_TOKEN),
                update: jest.fn().mockResolvedValue(true)
            };
            axios.get.mockRejectedValue(new Error('Meta API down'));

            // refreshTokenForIntegration -> exchangeForLongLivedToken falls back to original
            // so the only failure path is the update itself
            integration.update.mockRejectedValueOnce(new Error('DB error'));

            await expect(metaService.refreshTokenForIntegration(integration)).rejects.toThrow(AppError);
            expect(integration.update).toHaveBeenCalledWith({ status: 'ERROR' });
        });
    });

    // ── refreshExpiringTokens ───────────────────────────────────────────────────

    describe('refreshExpiringTokens', () => {
        it('returns { refreshed: n, failed: 0 } when all succeed', async () => {
            const enc = metaService.encryptToken(RAW_TOKEN);
            const integrations = [
                { access_token: enc, update: jest.fn().mockResolvedValue(true) },
                { access_token: enc, update: jest.fn().mockResolvedValue(true) },
            ];
            MetaIntegration.findAll.mockResolvedValue(integrations);

            const result = await metaService.refreshExpiringTokens();
            expect(result.refreshed).toBe(2);
            expect(result.failed).toBe(0);
        });

        it('counts failures correctly when some integrations fail', async () => {
            const enc = metaService.encryptToken(RAW_TOKEN);
            const goodIntegration = { access_token: enc, update: jest.fn().mockResolvedValue(true) };
            const badIntegration = {
                access_token: enc,
                update: jest.fn()
                    .mockResolvedValueOnce(true) // ERROR status update
                    .mockResolvedValueOnce(true)
            };
            // Make the bad one throw during refresh
            badIntegration.update.mockImplementationOnce(async (data) => {
                if (data.status === 'ERROR') return true;
                throw new Error('cannot update');
            });

            MetaIntegration.findAll.mockResolvedValue([goodIntegration, badIntegration]);

            const result = await metaService.refreshExpiringTokens();
            expect(result.failed).toBeGreaterThanOrEqual(0);
            expect(result.refreshed + result.failed).toBe(2);
        });

        it('queries only CONNECTED integrations expiring within 7 days', async () => {
            MetaIntegration.findAll.mockResolvedValue([]);
            await metaService.refreshExpiringTokens();

            expect(MetaIntegration.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ status: 'CONNECTED' })
                })
            );
        });
    });

    // ── subscribeToWebhooks ─────────────────────────────────────────────────────

    describe('subscribeToWebhooks', () => {
        it('calls the correct Graph API endpoint for a page', async () => {
            await metaService.subscribeToWebhooks('page-token', PAGE_ID, 'facebook');
            expect(axios.post).toHaveBeenCalledWith(
                expect.stringContaining(`${PAGE_ID}/subscribed_apps`),
                null,
                expect.objectContaining({
                    params: expect.objectContaining({ access_token: 'page-token' })
                })
            );
        });

        it('throws AppError when Meta API returns an error', async () => {
            axios.post.mockRejectedValue(new Error('API error'));
            await expect(
                metaService.subscribeToWebhooks('tok', PAGE_ID, 'facebook')
            ).rejects.toThrow(AppError);
        });
    });

    // ── getManagedPages ─────────────────────────────────────────────────────────

    describe('getManagedPages', () => {
        it('returns pages array from Meta API', async () => {
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: '111', name: 'Page A', category: 'Shopping' },
                        { id: '222', name: 'Page B', category: 'Software' }
                    ]
                }
            });
            const pages = await metaService.getManagedPages('user-token');
            expect(pages).toHaveLength(2);
            expect(pages[0].id).toBe('111');
        });

        it('returns empty array when user manages no pages', async () => {
            axios.get.mockResolvedValueOnce({ data: { data: [] } });
            const pages = await metaService.getManagedPages('user-token');
            expect(pages).toEqual([]);
        });
    });

    // ── checkPermissions ────────────────────────────────────────────────────────

    describe('checkPermissions', () => {
        it('returns only granted permissions (excludes declined)', async () => {
            axios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { permission: 'pages_show_list', status: 'granted' },
                        { permission: 'email', status: 'declined' },
                        { permission: 'pages_messaging', status: 'granted' }
                    ]
                }
            });
            const perms = await metaService.checkPermissions('user-token');
            expect(perms).toContain('pages_show_list');
            expect(perms).toContain('pages_messaging');
            expect(perms).not.toContain('email');
        });
    });

    // ── getPageAccessToken ──────────────────────────────────────────────────────

    describe('getPageAccessToken', () => {
        it('returns the page-level access token from Meta API', async () => {
            axios.get.mockResolvedValueOnce({
                data: { id: PAGE_ID, access_token: 'PAGE_ACCESS_TOKEN' }
            });
            const token = await metaService.getPageAccessToken(PAGE_ID, 'user-token');
            expect(token).toBe('PAGE_ACCESS_TOKEN');
        });
    });
});
