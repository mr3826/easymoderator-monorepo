const customerService = require('./customer.service');
const auditService = require('../audit/audit.service');
const { storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware, setAuditValues } = require('../audit/audit.middleware');

/**
 * Redact PII fields before writing to audit logs.
 * Masks phone and email so logs are GDPR-safe.
 */
const redactPII = (obj) => {
    if (!obj) return obj;
    const data = (typeof obj.toJSON === 'function') ? obj.toJSON() : { ...obj };
    if (data.phone)  data.phone  = data.phone.slice(0, 3)  + '****' + data.phone.slice(-2);
    if (data.number) data.number = data.number.slice(0, 3) + '****' + data.number.slice(-2);
    if (data.email)  data.email  = data.email.replace(/^(.{2}).*@/, '$1***@');
    return data;
};

/**
 * RESTful: Get customers with server-side pagination and filters
 */
const getCustomers = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { data, total, page, pageSize } = await customerService.listCustomers(
            req.user.userId,
            shopId,
            req.query
        );

        res.status(200).json({ success: true, data, total, page, pageSize });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const customer = await customerService.getCustomerById(req.params.id, req.user.userId, shopId);

        res.status(200).json({ success: true, data: customer });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const customer = await customerService.createCustomer(req.user.userId, shopId, req.body);

        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'CREATE',
            resourceType: 'CUSTOMER',
            resourceId: customer.id,
            newValues: redactPII(req.body),
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(201).json({ success: true, data: customer });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Update customer by ID
 * updateCustomer service now returns { customer, previousData } so we avoid
 * a redundant getCustomerById round-trip purely for audit logging.
 */
const updateCustomerById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { customer, previousData } = await customerService.updateCustomer(
            req.params.id,
            req.user.userId,
            shopId,
            req.body
        );

        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'UPDATE',
            resourceType: 'CUSTOMER',
            resourceId: req.params.id,
            oldValues: redactPII(previousData),
            newValues: redactPII(req.body),
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({ success: true, data: customer });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Delete customer by ID
 * deleteCustomer now returns a non-PII snapshot (id + channel_type) for audit.
 */
const deleteCustomerById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { message, deletedSnapshot } = await customerService.deleteCustomer(
            req.params.id,
            req.user.userId,
            shopId
        );

        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'DELETE',
            resourceType: 'CUSTOMER',
            resourceId: req.params.id,
            oldValues: deletedSnapshot,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({ success: true, message });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const customer = await customerService.createCustomer(req.user.userId, shopId, req.body);

        res.status(201).json({ success: true, data: customer });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { customerId, ...updateData } = req.body;
        const { customer } = await customerService.updateCustomer(customerId, req.user.userId, shopId, updateData);

        res.status(200).json({ success: true, data: customer });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const customer = await customerService.getCustomerById(req.query.customerId, req.user.userId, shopId);

        res.status(200).json({ success: true, data: customer });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const customer = await customerService.getCustomerByExternalId(
            req.params.customerId,
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { customer, isNew } = await customerService.findOrCreateCustomerByChannel(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(isNew ? 201 : 200).json({ customer_id: customer.id, is_new: isNew });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        await customerService.updateCustomer(req.params.customerId, req.user.userId, shopId, req.body);

        res.status(200).json({ customer_id: req.params.customerId, updated: true });
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
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { data, total, page, pageSize } = await customerService.listCustomers(
            req.user.userId,
            shopId,
            {
                search: req.query.search,
                phone: req.query.phone,
                email: req.query.email,
                channel_type: req.query.channel_type,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
                page: req.query.page,
                pageSize: req.query.pageSize
            }
        );

        res.status(200).json({ success: true, data, total, page, pageSize });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getCustomers,
    getCustomerById,
    createCustomerRest,
    updateCustomerById,
    deleteCustomerById,
    createCustomer,
    updateCustomer,
    getCustomer,
    listCustomers,
    getCustomerExternal,
    createCustomerExternal,
    updateCustomerExternal
};
