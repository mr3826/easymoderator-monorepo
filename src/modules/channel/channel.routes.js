const express = require('express');
const channelController = require('./channel.controller');
const channelValidator = require('./channel.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');
const { idempotencyMiddleware, storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware } = require('../audit/audit.middleware');

const router = express.Router();

// All channel routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(channelValidator.getChannels), channelController.getChannels);
router.get('/config/:channelType', channelController.getChannelConfig);
router.get('/:id', validate(channelValidator.getChannelById), channelController.getChannelById);
router.post('/connect', validate(channelValidator.connectChannel), channelController.connectChannelByType);
router.post('/:id/disconnect', validate(channelValidator.disconnectChannel), channelController.disconnectChannelById);
router.post('/',
    idempotencyMiddleware,
    validate(channelValidator.createChannel),
    channelController.createChannelRest,
    storeIdempotencyResult(201),
    auditLogMiddleware('CREATE', 'CHANNEL')
);
router.patch('/:id',
    idempotencyMiddleware,
    validate(channelValidator.updateChannel),
    channelController.updateChannelById,
    storeIdempotencyResult(200),
    auditLogMiddleware('UPDATE', 'CHANNEL')
);
router.delete('/:id',
    idempotencyMiddleware,
    validate(channelValidator.deleteChannel),
    channelController.deleteChannelById,
    storeIdempotencyResult(200),
    auditLogMiddleware('DELETE', 'CHANNEL')
);

module.exports = router;
