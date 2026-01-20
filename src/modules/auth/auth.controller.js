const authService = require('./auth.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Signup controller
 */
const signup = async (req, res, next) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const result = await authService.createUserWithShop(req.body);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Signin controller
 */
const signin = async (req, res, next) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { email, password } = req.body;
        const result = await authService.authenticateUser(email, password);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Refresh token controller
 */
const refresh = async (req, res, next) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { refresh_token } = req.body;
        const result = await authService.validateRefreshToken(refresh_token);

        res.status(200).json({
            success: true,
            message: 'Access token refreshed successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    signup,
    signin,
    refresh
};
