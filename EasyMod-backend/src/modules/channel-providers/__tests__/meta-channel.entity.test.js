/**
 * MetaChannel entity - getter/setter encryption transparency tests (TDD)
 * No DB connection required - Sequelize is mocked.
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.CHANNEL_ENCRYPTION_KEY = 'a'.repeat(64);
jest.mock('src/config/redis', () => ({ sessionRedis: null, cacheRedis: null, rateLimitRedis: null, closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({})) }));
jest.mock('src/utils/structured-logger', () => ({ createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })) }));
jest.mock('src/utils/database/database-setup', () => ({ sequelize: { define: jest.fn((name, attrs, opts) => ({ _name: name, _attrs: attrs, _opts: opts })), authenticate: jest.fn(), sync: jest.fn(), literal: jest.fn(s => s) } }));

function getMetaChannelAttrs() {
    const { sequelize } = require('src/utils/database/database-setup');
    sequelize.define.mockClear();
    jest.isolateModules(() => { require('src/modules/channel-providers/meta-channel.entity'); });
    const defineCall = sequelize.define.mock.calls.find(c => c[0] === 'MetaChannel');
    if (!defineCall) throw new Error('MetaChannel was not defined via sequelize.define()');
    return defineCall[1];
}

function getMetaChannelSettingsAttrs() {
    const { sequelize } = require('src/utils/database/database-setup');
    sequelize.define.mockClear();
    jest.isolateModules(() => { require('src/modules/channel-providers/meta-channel-settings.entity'); });
    const defineCall = sequelize.define.mock.calls.find(c => c[0] === 'MetaChannelSettings');
    if (!defineCall) throw new Error('MetaChannelSettings was not defined via sequelize.define()');
    return defineCall[1];
}

function makeTokenHelpers(attrs) {
    let rawValue;
    const inst = {
        getDataValue: jest.fn(() => rawValue),
        setDataValue: jest.fn((_, v) => { rawValue = v; }),
    };
    return {
        setToken: (t) => attrs.page_access_token_ct.set.call(inst, t),
        getToken: () => attrs.page_access_token_ct.get.call(inst),
        getRaw: () => rawValue,
    };
}

describe('MetaChannel entity - page_access_token_ct getter/setter', () => {
    let helpers;
    beforeAll(() => {
        const attrs = getMetaChannelAttrs();
        helpers = makeTokenHelpers(attrs);
    });

    it('setter encrypts: raw value has v2: prefix', () => {
        helpers.setToken('EAAMyPlaintextToken');
        expect(helpers.getRaw()).toMatch(/^v2:/);
    });

    it('getter decrypts - round-trip returns original plaintext', () => {
        helpers.setToken('EAAFacebookPageAccessToken12345');
        expect(helpers.getToken()).toBe('EAAFacebookPageAccessToken12345');
    });

    it('setter with null stores null', () => {
        helpers.setToken(null);
        expect(helpers.getRaw()).toBeNull();
    });

    it('getter returns null when stored value is null', () => {
        helpers.setToken(null);
        expect(helpers.getToken()).toBeNull();
    });

    it('getter returns null (does not throw) when stored value is corrupted', () => {
        const attrs = getMetaChannelAttrs();
        let raw = 'corrupted-garbage-value';
        const inst = { getDataValue: jest.fn(() => raw), setDataValue: jest.fn((_, v) => { raw = v; }) };
        expect(attrs.page_access_token_ct.get.call(inst)).toBeNull();
    });

    it('two setToken calls with same value produce different raw (random IV)', () => {
        helpers.setToken('same-token-value');
        const raw1 = helpers.getRaw();
        helpers.setToken('same-token-value');
        const raw2 = helpers.getRaw();
        expect(raw1).not.toBe(raw2);
    });

    it('handles long tokens (512+ chars)', () => {
        const longToken = 'EAA' + 'X'.repeat(512);
        helpers.setToken(longToken);
        expect(helpers.getToken()).toBe(longToken);
    });
});

describe('MetaChannel entity - model structure', () => {
    let attrs;
    beforeAll(() => { attrs = getMetaChannelAttrs(); });

    it('defines model named MetaChannel', () => {
        const { sequelize } = require('src/utils/database/database-setup');
        expect(sequelize.define.mock.calls.some(c => c[0] === 'MetaChannel')).toBe(true);
    });

    it('has required fields: id, shop_id, platform, meta_asset_id', () => {
        expect(attrs.id).toBeDefined();
        expect(attrs.shop_id).toBeDefined();
        expect(attrs.platform).toBeDefined();
        expect(attrs.meta_asset_id).toBeDefined();
    });

    it('page_access_token_ct has get and set functions', () => {
        expect(typeof attrs.page_access_token_ct.get).toBe('function');
        expect(typeof attrs.page_access_token_ct.set).toBe('function');
    });

    it('platform ENUM has facebook but NOT instagram or whatsapp', () => {
        const values = attrs.platform.type.values || [];
        expect(values).toContain('facebook');
        expect(values).not.toContain('instagram');
        expect(values).not.toContain('whatsapp');
    });

    it('status ENUM has all 5 required states', () => {
        const values = attrs.status.type.values || [];
        ['CONNECTED', 'TOKEN_EXPIRED', 'REVOKED', 'DISCONNECTED', 'ERROR'].forEach(s => {
            expect(values).toContain(s);
        });
    });
});

describe('MetaChannelSettings entity - defaults', () => {
    let attrs;
    beforeAll(() => { attrs = getMetaChannelSettingsAttrs(); });

    it('defaults newly connected channels to DRAFT, never straight to auto-send', () => {
        expect(attrs.ai_auto_reply.defaultValue).toBe(true);
        expect(attrs.automation_mode.defaultValue).toBe('DRAFT');
    });
});
