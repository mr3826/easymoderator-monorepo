const config = require('../config/config');

const isProduction = () => config.env === 'production';

// Cross-domain: frontend (easymod.tech) → backend (api.easymod.tech) are different origins.
// sameSite:'lax' silently blocks cookies on cross-site requests — the browser simply
// does not send them. For tokens to reach api.easymod.tech from easymod.tech, we need
// sameSite:'none' (which requires secure:true in all browsers that enforce the pairing rule).
// In development we fall back to 'lax' since localhost is same-site with localhost.
const SAME_SITE = () => (isProduction() ? 'none' : 'lax');

const COOKIE_OPTIONS_ACCESS = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: SAME_SITE(),
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
    ...(config.cookieDomain && { domain: config.cookieDomain })
});

const COOKIE_OPTIONS_REFRESH = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: SAME_SITE(),
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    ...(config.cookieDomain && { domain: config.cookieDomain })
});

const setAuthCookies = (res, accessToken, refreshToken) => {
    res.cookie('access_token', accessToken, COOKIE_OPTIONS_ACCESS());
    if (refreshToken) {
        res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS_REFRESH());
    }
};

const clearAuthCookies = (res) => {
    const opts = (path) => ({ path, ...(config.cookieDomain && { domain: config.cookieDomain }) });
    res.clearCookie('access_token', opts('/'));
    res.clearCookie('refresh_token', opts('/api/auth'));
    // Clear legacy cookies set before the API prefix was included in the path.
    res.clearCookie('refresh_token', opts('/auth'));
};

module.exports = {
    setAuthCookies,
    clearAuthCookies
};
