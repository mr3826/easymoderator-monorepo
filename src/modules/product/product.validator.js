const Joi = require('joi');

class ProductValidator {
    createProduct = {
        body: Joi.object({
            name: Joi.string().trim().required().max(255).messages({
                'string.empty': 'Product name is required',
                'string.max': 'Product name must not exceed 255 characters'
            }),
            description: Joi.string().trim().optional(),
            sku: Joi.string().trim().optional().max(100).messages({
                'string.max': 'SKU must not exceed 100 characters'
            }),
            category_id: Joi.string().uuid().optional().messages({
                'string.uuid': 'Category ID must be a valid UUID'
            }),
            price: Joi.number().positive().required().messages({
                'number.base': 'Price is required',
                'number.positive': 'Price must be a positive number'
            }),
            compare_at_price: Joi.number().positive().optional().messages({
                'number.positive': 'Compare at price must be a positive number'
            }),
            cost_per_item: Joi.number().positive().optional().messages({
                'number.positive': 'Cost per item must be a positive number'
            }),
            track_quantity: Joi.boolean().optional(),
            quantity: Joi.number().integer().min(0).optional().messages({
                'number.min': 'Quantity must be a non-negative integer'
            }),
            allow_backorder: Joi.boolean().optional(),
            low_stock_threshold: Joi.number().integer().min(0).optional().messages({
                'number.min': 'Low stock threshold must be a non-negative integer'
            }),
            images: Joi.array().items(Joi.string()).optional(),
            weight: Joi.number().positive().optional().messages({
                'number.positive': 'Weight must be a positive number'
            }),
            weight_unit: Joi.string().valid('kg', 'g', 'lb', 'oz').optional().messages({
                'any.only': 'Weight unit must be one of: kg, g, lb, oz'
            }),
            is_active: Joi.boolean().optional(),
            is_featured: Joi.boolean().optional(),
            tags: Joi.array().items(Joi.string()).optional(),
            variants: Joi.array().items(Joi.object({
                name: Joi.string().required(),
                options: Joi.array().items(Joi.string()).required(),
                price_adjustment: Joi.number().optional(),
                sku: Joi.string().optional()
            })).optional(),
            seo_title: Joi.string().trim().optional().max(60),
            seo_description: Joi.string().trim().optional().max(160),
            ai_generated: Joi.boolean().optional(),
            confidence: Joi.number().min(0).max(1).optional()
        })
    };

    updateProduct = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Product ID must be a valid UUID'
            })
        }),
        body: Joi.object({
            name: Joi.string().trim().optional().max(255).messages({
                'string.max': 'Product name must not exceed 255 characters'
            }),
            description: Joi.string().trim().optional(),
            sku: Joi.string().trim().optional().max(100).messages({
                'string.max': 'SKU must not exceed 100 characters'
            }),
            category_id: Joi.string().uuid().optional().messages({
                'string.uuid': 'Category ID must be a valid UUID'
            }),
            price: Joi.number().positive().optional().messages({
                'number.positive': 'Price must be a positive number'
            }),
            compare_at_price: Joi.number().positive().optional().messages({
                'number.positive': 'Compare at price must be a positive number'
            }),
            cost_per_item: Joi.number().positive().optional().messages({
                'number.positive': 'Cost per item must be a positive number'
            }),
            track_quantity: Joi.boolean().optional(),
            quantity: Joi.number().integer().min(0).optional().messages({
                'number.min': 'Quantity must be a non-negative integer'
            }),
            allow_backorder: Joi.boolean().optional(),
            low_stock_threshold: Joi.number().integer().min(0).optional().messages({
                'number.min': 'Low stock threshold must be a non-negative integer'
            }),
            images: Joi.array().items(Joi.string()).optional(),
            weight: Joi.number().positive().optional().messages({
                'number.positive': 'Weight must be a positive number'
            }),
            weight_unit: Joi.string().valid('kg', 'g', 'lb', 'oz').optional().messages({
                'any.only': 'Weight unit must be one of: kg, g, lb, oz'
            }),
            is_active: Joi.boolean().optional(),
            is_featured: Joi.boolean().optional(),
            tags: Joi.array().items(Joi.string()).optional(),
            variants: Joi.array().items(Joi.object({
                name: Joi.string().required(),
                options: Joi.array().items(Joi.string()).required(),
                price_adjustment: Joi.number().optional(),
                sku: Joi.string().optional()
            })).optional(),
            seo_title: Joi.string().trim().optional().max(60),
            seo_description: Joi.string().trim().optional().max(160),
            ai_generated: Joi.boolean().optional(),
            confidence: Joi.number().min(0).max(1).optional()
        })
    };

    getProducts = {
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20),
            category_id: Joi.string().uuid().optional(),
            is_active: Joi.boolean().optional(),
            search: Joi.string().trim().optional(),
            sort_by: Joi.string().valid('name', 'price', 'created_at', 'updated_at').default('created_at'),
            sort_order: Joi.string().valid('asc', 'desc').default('desc')
        })
    };

    getProductById = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Product ID must be a valid UUID'
            })
        })
    };

    deleteProduct = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Product ID must be a valid UUID'
            })
        })
    };
}

module.exports = new ProductValidator();
