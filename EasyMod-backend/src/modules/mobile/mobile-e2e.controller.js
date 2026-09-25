'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { sendSuccess } = require('../../utils/AppError');
const fixtures = require('./mobile-e2e-fixtures');

/**
 * POST /api/mobile/e2e/control
 *
 * This route is conditionally registered by mobile.routes.js and repeats the
 * environment/header guard at request time so a loaded test process cannot
 * mutate fixture data after its controls are disabled.
 */
const control = asyncHandler(async (req, res) => {
    fixtures.assertFixtureControlRequest(req);
    const data = await fixtures.applyControl(req.body || {});
    sendSuccess(res, data);
});

module.exports = { control };
