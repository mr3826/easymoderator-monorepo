const config = require('../config/config');

const isProduction = () => config.env === 'production';

const COOKIE_OPTIONS_ACCESS = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
    ...(config.cookieDomain && { domain: config.cookieDomain })
});

const COOKIE_OPTIONS_REFRESH = () => ({
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/auth',
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
    res.clearCookie('refresh_token', opts('/auth'));
};

module.exports = {
    setAuthCookies,
    clearAuthCookies
};
