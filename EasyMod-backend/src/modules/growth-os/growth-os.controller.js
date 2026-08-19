'use strict';

const service = require('./growth-os.service');

exports.getSession = async (req, res, next) => {
  try {
    const data = await service.getSession(req.user.userId, req.growthOs);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
