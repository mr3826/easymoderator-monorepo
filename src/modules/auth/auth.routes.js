const express = require('express');
const authController = require('./auth.controller');
const { signupValidator, signinValidator, refreshTokenValidator, forgotPasswordValidator, resetPasswordValidator } = require('./auth.validator');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

// POST /auth/signup - User registration
router.post('/signup', signupValidator, authController.signup);

// POST /auth/signin - User login
router.post('/signin', signinValidator, authController.signin);

// POST /auth/refresh - Refresh access token
router.post('/refresh', refreshTokenValidator, authController.refresh);

// GET /auth/me - Get current auth context
router.get('/me', authenticate, authController.me);

// POST /auth/forgot-password - Request password reset email
router.post('/forgot-password', forgotPasswordValidator, authController.forgotPassword);

// POST /auth/reset-password - Reset password with token
router.post('/reset-password', resetPasswordValidator, authController.resetPassword);

// POST /auth/logout - Logout and revoke token
router.post('/logout', authenticate, authController.logout);

module.exports = router;
