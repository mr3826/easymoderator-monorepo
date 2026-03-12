const express = require('express');
const authController = require('./auth.controller');
const { signupValidator, signinValidator, refreshTokenValidator, forgotPasswordValidator, resetPasswordValidator } = require('./auth.validator');
const { authenticate } = require('../../middleware/auth.middleware');
const validate = require('../../middleware/validate.middleware');

const router = express.Router();

// POST /auth/signup - User registration
router.post('/signup', validate(signupValidator), authController.signup);

// POST /auth/signin - User login
router.post('/signin', validate(signinValidator), authController.signin);

// POST /auth/refresh - Refresh access token
router.post('/refresh', validate(refreshTokenValidator), authController.refresh);

// GET /auth/me - Get current auth context
router.get('/me', authenticate, authController.me);

// POST /auth/forgot-password - Request password reset email
router.post('/forgot-password', validate(forgotPasswordValidator), authController.forgotPassword);

// POST /auth/reset-password - Reset password with token
router.post('/reset-password', validate(resetPasswordValidator), authController.resetPassword);

// POST /auth/logout - Logout and revoke token
router.post('/logout', authenticate, authController.logout);

module.exports = router;
