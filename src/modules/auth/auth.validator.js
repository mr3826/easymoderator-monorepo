const { body } = require('express-validator');

const signupValidator = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    body('full_name')
        .optional()
        .trim()
        .isLength({ min: 2 })
        .withMessage('Full name must be at least 2 characters long'),
    body('phone')
        .optional()
        .trim()
];

const signinValidator = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail(),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

const refreshTokenValidator = [
    body('refresh_token')
        .notEmpty()
        .withMessage('Refresh token is required')
];

const forgotPasswordValidator = [
    body('email')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail()
];

const resetPasswordValidator = [
    body('token')
        .notEmpty()
        .withMessage('Reset token is required'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
];

module.exports = {
    signupValidator,
    signinValidator,
    refreshTokenValidator,
    forgotPasswordValidator,
    resetPasswordValidator
};
