const templateService = require('./response-template.service');
const { AppError } = require('../../utils/AppError');

/**
 * POST /templates
 * Create a new response template.
 */
const createTemplate = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const template = await templateService.createTemplate(shopId, req.body);
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /templates
 * List all templates for the current shop, optionally filtered by ?category=
 */
const listTemplates = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const { category } = req.query;
        const templates = await templateService.listTemplates(shopId, category);
        res.status(200).json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

/**
 * PATCH /templates/:id
 * Update a template.
 */
const updateTemplate = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const { id } = req.params;
        const template = await templateService.updateTemplate(shopId, id, req.body);
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /templates/:id
 * Delete a template.
 */
const deleteTemplate = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const { id } = req.params;
        const result = await templateService.deleteTemplate(shopId, id);
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /templates/:id/render
 * Render a template with provided variables.
 * Body: { variables: { customer_name: "Alice", order_id: "123" } }
 */
const renderTemplate = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) throw new AppError('No shop selected', 400);

        const { id } = req.params;
        const { variables = {} } = req.body;

        const templates = await templateService.listTemplates(shopId);
        const template = templates.find(t => t.id === id);
        if (!template) throw new AppError('Template not found', 404);

        const rendered = templateService.renderTemplate(template.content, variables);
        res.status(200).json({ success: true, data: { rendered } });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createTemplate,
    listTemplates,
    updateTemplate,
    deleteTemplate,
    renderTemplate
};
