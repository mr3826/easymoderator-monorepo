const customerService = require('./customer.service');
const auditService = require('../audit/audit.service');
const { storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware, setAuditValues } = require('../audit/audit.middleware');

/**
 * RESTful: Get customers with pagination and filters
 */
const getCustomers = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const filters = req.query; // Already validated
        const customers = await customerService.listCustomers(
            req.user.userId,
            shopId,
            filters
        );

        res.status(200).json({
            success: true,
            data: customers
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Get customer by ID
 */
const getCustomerById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const customer = await customerService.getCustomerById(
            id,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Create customer
 */
const createCustomerRest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const customer = await customerService.createCustomer(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        // Audit log the creation
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'CREATE',
            resourceType: 'CUSTOMER',
            resourceId: customer.id,
            newValues: req.body,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(201).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Update customer by ID
 */
const updateCustomerById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated

        // Get current customer for audit logging
        const currentCustomer = await customerService.getCustomerById(id, req.user.userId, shopId);

        const customer = await customerService.updateCustomer(
            id,
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        // Audit log the update
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'UPDATE',
            resourceType: 'CUSTOMER',
            resourceId: id,
            oldValues: currentCustomer,
            newValues: req.body,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Delete customer by ID
 */
const deleteCustomerById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated

        // Get current customer for audit logging
        const currentCustomer = await customerService.getCustomerById(id, req.user.userId, shopId);

        const result = await customerService.deleteCustomer(
            id,
            req.user.userId,
            shopId
        );

        // Audit log the deletion
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'DELETE',
            resourceType: 'CUSTOMER',
            resourceId: id,
            oldValues: currentCustomer,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Create a new customer (backward compatibility)
 */
const createCustomer = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const customer = await customerService.createCustomer(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Update a customer (backward compatibility)
 */
const updateCustomer = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customerId, ...updateData } = req.body;
        const customer = await customerService.updateCustomer(
            customerId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Get a single customer (backward compatibility)
 */
const getCustomer = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customerId } = req.query;
        const customer = await customerService.getCustomerById(
            customerId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Get customer by external ID
 */
const getCustomerExternal = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customerId } = req.params;
        const customer = await customerService.getCustomerByExternalId(
            customerId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            customer_id: customer.id,
            phone: customer.phone,
            name: customer.name,
            language_preference: customer.language_preference,
            created_at: customer.created_at,
            last_active: customer.last_active,
            metadata: customer.metadata || {}
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Create or find customer by channel identifiers
 */
const createCustomerExternal = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customer, isNew } = await customerService.findOrCreateCustomerByChannel(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            customer_id: customer.id,
            is_new: isNew
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Update customer by external ID
 */
const updateCustomerExternal = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { customerId } = req.params;

        await customerService.updateCustomer(
            customerId,
            req.user.userId,
            shopId,
            req.body
        );

        res.status(200).json({
            customer_id: customerId,
            updated: true
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: List all customers for the shop with filters (backward compatibility)
 */
const listCustomers = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const filters = {
            search: req.query.search,
            phone: req.query.phone,
            channel_type: req.query.channel_type,
            start_date: req.query.start_date,
            end_date: req.query.end_date
        };

        const customers = await customerService.listCustomers(
            req.user.userId,
            shopId,
            filters
        );

        res.status(200).json({
            success: true,
            data: customers
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    // RESTful methods
    getCustomers,
    getCustomerById,
    createCustomerRest,
    updateCustomerById,
    deleteCustomerById,
    // Legacy methods for backward compatibility
    createCustomer,
    updateCustomer,
    getCustomer,
    listCustomers,
    // V2 methods
    getCustomerExternal,
    createCustomerExternal,
    updateCustomerExternal
};
