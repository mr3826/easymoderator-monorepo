const config = require('../config/config');

const isProduction = () => config.env === 'production';

// Production may run either same-origin (easymod.tech/api) or legacy API-subdomain
// (api.easymod.tech). Keep SameSite=None in production so both topologies work.
const SAME_SITE = () => (isProduction() ? 'none' : 'lax');

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

const clearAuthCookies = (res, req) => {
    clearCookie(res, 'access_token', '/', req);
    clearCookie(res, 'refresh_token', '/api/auth', req);
    // Clear legacy cookies set before the API prefix was included in the path.
    clearCookie(res, 'refresh_token', '/auth', req);
};

module.exports = {
    setAuthCookies,
    clearAuthCookies,
    resolveCookieDomain
};
