'use strict';

const { AppError } = require('../../utils/AppError');
const setupStatusService = require('./setup-status.service');

const getSetupStatus = async (req, res, next) => {
    try {
        const { shopId, userId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const status = await setupStatusService.getSetupStatus({ shopId, userId });
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSetupStatus,
};
