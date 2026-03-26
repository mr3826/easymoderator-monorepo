const express = require('express');
const formSchemaController = require('./form-schema.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All form-schema routes require authentication
router.use(authenticate);

// Static paths before parameterised routes
router.get('/active', formSchemaController.getActiveSchema);
router.post('/', formSchemaController.createSchema);
router.patch('/:schemaId', formSchemaController.updateSchema);
router.delete('/:schemaId', formSchemaController.deleteSchema);

module.exports = router;
