const express = require('express');
const authController = require('./auth.controller');
const { signupValidator, signinValidator, refreshTokenValidator } = require('./auth.validator');

const router = express.Router();

// POST /auth/signup - User registration
router.post('/signup', signupValidator, authController.signup);

// POST /auth/signin - User login
router.post('/signin', signinValidator, authController.signin);

// POST /auth/refresh - Refresh access token
router.post('/refresh', refreshTokenValidator, authController.refresh);

module.exports = router;
