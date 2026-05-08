const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Generate access token (valid for 1 day)
 * @param {Object} payload - { userId, email }
 * @returns {String} JWT access token
 */
const generateAccessToken = (payload) => {
    return jwt.sign(payload, config.jwtAccessSecret, {
        expiresIn: config.jwtAccessExpiresIn
    });
};

/**
 * Generate refresh token (valid for 30 days)
 * @param {Object} payload - { userId }
 * @returns {String} JWT refresh token
 */
const generateRefreshToken = (payload) => {
    return jwt.sign(payload, config.jwtRefreshSecret, {
        expiresIn: config.jwtRefreshExpiresIn
    });
};

/**
 * Verify access token
 * @param {String} token - JWT access token
 * @returns {Object} Decoded payload
 */
const verifyAccessToken = (token) => {
    try {
        return jwt.verify(token, config.jwtAccessSecret, { algorithms: ['HS256'] });
    } catch (error) {
        throw new Error('Invalid or expired access token');
    }
};

/**
 * Verify refresh token
 * @param {String} token - JWT refresh token
 * @returns {Object} Decoded payload
 */
const verifyRefreshToken = (token) => {
    try {
        return jwt.verify(token, config.jwtRefreshSecret, { algorithms: ['HS256'] });
    } catch (error) {
        throw new Error('Invalid or expired refresh token');
    }
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
};
