const { FormSchema } = require('../entities');
const { AppError } = require('../../utils/AppError');

/**
 * Create a new form schema for a shop
 */
const createSchema = async (shopId, data) => {
    const { name, fields } = data;

    if (!name) {
        throw new AppError('name is required', 400);
    }

    if (!Array.isArray(fields) || fields.length === 0) {
        throw new AppError('fields must be a non-empty array', 400);
    }

    const schema = await FormSchema.create({
        shop_id: shopId,
        name,
        fields,
        is_active: data.is_active !== undefined ? data.is_active : true
    });

    return schema;
};

/**
 * Get the active form schema for a shop.
 * Returns the most recently updated active schema, or null if none exists.
 */
const getActiveSchema = async (shopId) => {
    const schema = await FormSchema.findOne({
        where: { shop_id: shopId, is_active: true },
        order: [['updated_at', 'DESC']]
    });
    return schema;
};

/**
 * Update an existing form schema
 */
const updateSchema = async (shopId, schemaId, data) => {
    const schema = await FormSchema.findOne({ where: { id: schemaId, shop_id: shopId } });
    if (!schema) {
        throw new AppError('Form schema not found', 404);
    }

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.fields !== undefined) {
        if (!Array.isArray(data.fields) || data.fields.length === 0) {
            throw new AppError('fields must be a non-empty array', 400);
        }
        updates.fields = data.fields;
    }
    if (data.is_active !== undefined) updates.is_active = data.is_active;

    await schema.update(updates);
    return schema;
};

/**
 * Delete (soft: deactivate) a form schema
 */
const deleteSchema = async (shopId, schemaId) => {
    const schema = await FormSchema.findOne({ where: { id: schemaId, shop_id: shopId } });
    if (!schema) {
        throw new AppError('Form schema not found', 404);
    }

    await schema.destroy();
    return { message: 'Form schema deleted successfully' };
};

module.exports = {
    createSchema,
    getActiveSchema,
    updateSchema,
    deleteSchema
};
