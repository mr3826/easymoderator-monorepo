const express = require('express');
const ragController = require('./rag.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { ingestDataValidator, queryDataValidator } = require('./rag.validator');
const validate = require('../../middleware/validate.middleware');

const router = express.Router();

// All RAG routes require authentication
router.use(authenticate);

// POST /rag/ingest - Ingest data into RAG system
router.post('/ingest', validate(ingestDataValidator), ragController.ingestData);

// POST /rag/query - Query RAG system
router.post('/query', validate(queryDataValidator), ragController.queryData);

module.exports = router;
