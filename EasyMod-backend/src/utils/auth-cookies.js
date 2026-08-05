const config = require('../config/config');

const isProduction = () => config.env === 'production';

// app.easymod.tech and api.easymod.tech are separate origins but the same
// schemeful site. Lax cookies work for credentialed app-to-API requests while
// withholding auth cookies from genuinely cross-site requests.
const SAME_SITE = () => 'lax';

const normalizeHostname = (host) => {
    const value = String(host || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .split('?')[0]
        .replace(/^\*\./, '')
        .replace(/^\./, '')
        .toLowerCase();

    return value.split(':')[0];
};

const getRequestHostname = (req) => {
    if (!req) return '';
    return normalizeHostname(req.hostname || req.headers?.host);
};

const getConfiguredCookieDomain = () => normalizeHostname(config.cookieDomain);
const getLegacyCookieDomain = () => normalizeHostname(config.legacyCookieDomain);

const resolveCookieDomain = (req) => {
    const configuredDomain = getConfiguredCookieDomain();
    if (!configuredDomain) return undefined;

    const requestHostname = getRequestHostname(req);
    if (!requestHostname) return configuredDomain;

    if (requestHostname === configuredDomain || requestHostname.endsWith(`.${configuredDomain}`)) {
        return configuredDomain;
    }

    return undefined;
};

const cookieDomainOption = (req) => {
    const domain = resolveCookieDomain(req);
    return domain ? { domain } : {};
};

const COOKIE_OPTIONS_ACCESS = (req) => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: SAME_SITE(),
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
    ...cookieDomainOption(req)
});

const COOKIE_OPTIONS_REFRESH = (req) => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: SAME_SITE(),
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    ...cookieDomainOption(req)
});

const setAuthCookies = (res, accessToken, refreshToken, req) => {
    // Expire parent-domain cookies issued by the pre-split deployment before
    // writing the new API-host-only pair. Remove this compatibility path after
    // the documented migration window.
    clearLegacyAuthCookies(res, req);
    res.cookie('access_token', accessToken, COOKIE_OPTIONS_ACCESS(req));
    if (refreshToken) {
        res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS_REFRESH(req));
    }
};

const clearCookie = (res, name, path, req) => {
    const baseOptions = { path };
    res.clearCookie(name, baseOptions);

    const domain = resolveCookieDomain(req);
    if (domain) {
        res.clearCookie(name, { ...baseOptions, domain });
    }
};

const clearLegacyCookie = (res, name, path, req) => {
    const legacyDomain = getLegacyCookieDomain();
    const requestHostname = getRequestHostname(req);
    if (!legacyDomain || !requestHostname
        || (requestHostname !== legacyDomain && !requestHostname.endsWith(`.${legacyDomain}`))) {
        return;
    }
    res.clearCookie(name, { path, domain: legacyDomain });
};

const clearLegacyAuthCookies = (res, req) => {
    clearLegacyCookie(res, 'access_token', '/', req);
    clearLegacyCookie(res, 'refresh_token', '/api/auth', req);
    clearLegacyCookie(res, 'refresh_token', '/auth', req);
};

const clearAuthCookies = (res, req) => {
    clearCookie(res, 'access_token', '/', req);
    clearCookie(res, 'refresh_token', '/api/auth', req);
    // Clear legacy cookies set before the API prefix was included in the path.
    clearCookie(res, 'refresh_token', '/auth', req);
    clearLegacyAuthCookies(res, req);
};

module.exports = {
    setAuthCookies,
    clearAuthCookies,
    resolveCookieDomain
};
