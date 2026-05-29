const ResponseTemplate = require('./response-template.entity');
const { AppError } = require('../../utils/AppError');

/**
 * Create a new response template for a shop.
 */
const createTemplate = async (shopId, data) => {
    const { name, content, variables = [], category, is_active } = data;

    if (!name) throw new AppError('Template name is required', 400);
    if (!content) throw new AppError('Template content is required', 400);

    const template = await ResponseTemplate.create({
        shop_id: shopId,
        name,
        content,
        variables,
        category: category || null,
        is_active: is_active !== undefined ? is_active : true
    });

    return template;
};

/**
 * List all templates for a shop, optionally filtered by category.
 */
const listTemplates = async (shopId, category) => {
    const where = { shop_id: shopId };
    if (category) where.category = category;

    const templates = await ResponseTemplate.findAll({
        where,
        order: [['created_at', 'DESC']]
    });

    return templates;
};

/**
 * Update a template by ID, scoped to the shop.
 */
const updateTemplate = async (shopId, id, data) => {
    const template = await ResponseTemplate.findOne({ where: { id, shop_id: shopId } });
    if (!template) throw new AppError('Template not found', 404);

    const allowed = ['name', 'content', 'variables', 'category', 'is_active'];
    const updates = {};
    for (const key of allowed) {
        if (data[key] !== undefined) updates[key] = data[key];
    }

    await template.update(updates);
    return template;
};

/**
 * Delete a template by ID, scoped to the shop.
 */
const deleteTemplate = async (shopId, id) => {
    const template = await ResponseTemplate.findOne({ where: { id, shop_id: shopId } });
    if (!template) throw new AppError('Template not found', 404);

    await template.destroy();
    return { message: 'Template deleted successfully' };
};

/**
 * Render a template by replacing {{key}} placeholders with values.
 *
 * @param {string} templateContent - Template string with {{variable}} placeholders
 * @param {object} variables - Key/value map of variable substitutions
 * @returns {string} Rendered string
 */
const renderTemplate = (templateContent, variables = {}) => {
    if (!templateContent) return '';
    return templateContent.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] !== undefined ? variables[key] : match;
    });
};

module.exports = {
    createTemplate,
    listTemplates,
    updateTemplate,
    deleteTemplate,
    renderTemplate
};
