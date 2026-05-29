const express = require('express');
const router = express.Router();
const templateController = require('./response-template.controller');
const { authenticate } = require('../../middleware/auth.middleware');

// All template routes require authentication
router.use(authenticate);

// GET /templates - List all templates (optionally filter by ?category=)
router.get('/', templateController.listTemplates);

// POST /templates - Create a new template
router.post('/', templateController.createTemplate);

// PATCH /templates/:id - Update a template
router.patch('/:id', templateController.updateTemplate);

// DELETE /templates/:id - Delete a template
router.delete('/:id', templateController.deleteTemplate);

// POST /templates/:id/render - Render a template with variables
router.post('/:id/render', templateController.renderTemplate);

module.exports = router;
