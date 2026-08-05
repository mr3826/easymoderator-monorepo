'use strict';

describe('auth cookie domain resolution', () => {
    const loadAuthCookies = (cookieDomain, legacyCookieDomain) => {
        jest.resetModules();
        jest.doMock('../../config/config', () => ({
            env: 'production',
            cookieDomain,
            legacyCookieDomain,
        }));
        return require('../auth-cookies');
    };

    const requestForHost = (host) => ({
        hostname: host,
        headers: { host }
    });

    afterEach(() => {
        jest.dontMock('../../config/config');
        jest.resetModules();
    });

    test('omits stale API-subdomain cookie domain on apex same-origin deployment', () => {
        const { resolveCookieDomain, setAuthCookies } = loadAuthCookies('api.easymod.tech');
        const req = requestForHost('easymod.tech');
        const cookies = [];
        const res = {
            cookie: (name, value, options) => cookies.push({ name, value, options }),
            clearCookie: jest.fn(),
        };

        expect(resolveCookieDomain(req)).toBeUndefined();

        setAuthCookies(res, 'access-token', 'refresh-token', req);

        expect(cookies).toHaveLength(2);
        expect(cookies[0].name).toBe('access_token');
        expect(cookies[0].options.domain).toBeUndefined();
        expect(cookies[1].name).toBe('refresh_token');
        expect(cookies[1].options.domain).toBeUndefined();
    });

    test('keeps configured parent domain for legacy API-subdomain requests', () => {
        const { resolveCookieDomain, setAuthCookies } = loadAuthCookies('easymod.tech');
        const req = requestForHost('api.easymod.tech');
        const cookies = [];
        const res = {
            cookie: (name, value, options) => cookies.push({ name, value, options }),
            clearCookie: jest.fn(),
        };

        expect(resolveCookieDomain(req)).toBe('easymod.tech');

        setAuthCookies(res, 'access-token', 'refresh-token', req);

        expect(cookies[0].options.domain).toBe('easymod.tech');
        expect(cookies[1].options.domain).toBe('easymod.tech');
    });

    test('keeps configured API subdomain when request host matches it', () => {
        const { resolveCookieDomain } = loadAuthCookies('api.easymod.tech');

        expect(resolveCookieDomain(requestForHost('api.easymod.tech'))).toBe('api.easymod.tech');
    });

    test('falls back to Host header and ignores the port while resolving domain', () => {
        const { resolveCookieDomain } = loadAuthCookies('.easymod.tech');
        const req = {
            headers: { host: 'easymod.tech:443' }
        };

        expect(resolveCookieDomain(req)).toBe('easymod.tech');
    });

    test('normalizes an accidentally URL-shaped cookie domain secret', () => {
        const { resolveCookieDomain } = loadAuthCookies('https://easymod.tech/');

        expect(resolveCookieDomain(requestForHost('easymod.tech'))).toBe('easymod.tech');
    });

    test('clears both host-only and valid domain-scoped auth cookies', () => {
        const { clearAuthCookies } = loadAuthCookies('easymod.tech');
        const req = requestForHost('easymod.tech');
        const cleared = [];
        const res = {
            clearCookie: (name, options) => cleared.push({ name, options })
        };

        clearAuthCookies(res, req);

        expect(cleared).toEqual([
            { name: 'access_token', options: { path: '/' } },
            { name: 'access_token', options: { path: '/', domain: 'easymod.tech' } },
            { name: 'refresh_token', options: { path: '/api/auth' } },
            { name: 'refresh_token', options: { path: '/api/auth', domain: 'easymod.tech' } },
            { name: 'refresh_token', options: { path: '/auth' } },
            { name: 'refresh_token', options: { path: '/auth', domain: 'easymod.tech' } }
        ]);
    });

    test('sets Secure SameSite=Lax host-only cookies and clears the legacy parent domain', () => {
        const { setAuthCookies } = loadAuthCookies(undefined, 'easymod.tech');
        const cookies = [];
        const cleared = [];
        const res = {
            cookie: (name, value, options) => cookies.push({ name, value, options }),
            clearCookie: (name, options) => cleared.push({ name, options }),
        };

        setAuthCookies(res, 'access-token', 'refresh-token', requestForHost('api.easymod.tech'));

        expect(cookies).toHaveLength(2);
        for (const cookie of cookies) {
            expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
            expect(cookie.options.domain).toBeUndefined();
        }
        expect(cleared).toEqual(expect.arrayContaining([
            { name: 'access_token', options: { path: '/', domain: 'easymod.tech' } },
            { name: 'refresh_token', options: { path: '/api/auth', domain: 'easymod.tech' } },
        ]));
    });
});
