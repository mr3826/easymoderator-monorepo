const formSchemaService = require('./form-schema.service');

/**
 * Create a form schema
 * POST /form-schemas
 */
const createSchema = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const schema = await formSchemaService.createSchema(shopId, req.body);
        res.status(201).json({ success: true, data: schema });
    } catch (error) {
        next(error);
    }
};

/**
 * Get the active form schema for the shop
 * GET /form-schemas/active
 */
const getActiveSchema = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const schema = await formSchemaService.getActiveSchema(shopId);
        res.status(200).json({ success: true, data: schema || null });
    } catch (error) {
        next(error);
    }
};

/**
 * Update a form schema
 * PATCH /form-schemas/:schemaId
 */
const updateSchema = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { schemaId } = req.params;
        const schema = await formSchemaService.updateSchema(shopId, schemaId, req.body);
        res.status(200).json({ success: true, data: schema });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a form schema
 * DELETE /form-schemas/:schemaId
 */
const deleteSchema = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { schemaId } = req.params;
        const result = await formSchemaService.deleteSchema(shopId, schemaId);
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createSchema,
    getActiveSchema,
    updateSchema,
    deleteSchema
};
