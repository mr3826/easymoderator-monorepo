const { Customer, Shop, UserShop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { Op } = require('sequelize');

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }

    return userShop;
};

/**
 * Create a new customer
 */
const createCustomer = async (userId, shopId, customerData) => {
    await verifyShopAccess(userId, shopId);

    const phone = customerData.number || customerData.phone;
    const email = customerData.email;

    // Only include non-null values in duplicate check to avoid matching NULL rows
    const orConditions = [];
    if (phone) orConditions.push({ phone });
    if (email) orConditions.push({ email });

    if (orConditions.length > 0) {
        const existing = await Customer.findOne({
            where: {
                shop_id: shopId,
                [Op.or]: orConditions
            }
        });
        if (existing) throw new AppError('Duplicate customer detected', 409);
    }

    const channelType = customerData.channel || customerData.channel_type || 'manual';

    // Use a stable, unique channel_user_id. For manual customers without a phone,
    // generate a unique placeholder to prevent collisions in findOrCreate lookups.
    const channelUserId =
        customerData.channel_user_id ||
        phone ||
        `manual-${shopId}-${Date.now()}`;

    const customer = await Customer.create({
        shop_id: shopId,
        name: customerData.name,
        phone,
        email: email || null,
        channel_type: channelType,
        channel_user_id: channelUserId,
        language_preference: customerData.language_preference || null,
        metadata: customerData.metadata || {}
    });

    return customer;
};

/**
 * Update a customer — returns { previousData, customer }
 * so callers can audit the diff without a second DB round-trip.
 */
const updateCustomer = async (customerId, userId, shopId, updateData) => {
    await verifyShopAccess(userId, shopId);

    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    // Capture state before mutation for audit
    const previousData = customer.toJSON();

    // Map frontend field names to model field names
    const mapped = { ...updateData };
    if (mapped.number !== undefined) { mapped.phone = mapped.number; delete mapped.number; }
    if (mapped.channel !== undefined) { mapped.channel_type = mapped.channel; delete mapped.channel; }

    // Allowlist updatable fields to prevent mass assignment
    const ALLOWED = ['name', 'email', 'phone', 'channel_type', 'language_preference', 'metadata'];
    const safeData = {};
    ALLOWED.forEach(field => {
        if (mapped[field] !== undefined) safeData[field] = mapped[field];
    });

    await customer.update(safeData);

    return { customer, previousData };
};

/**
 * Get a single customer by ID
 */
const getCustomerById = async (customerId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    return customer;
};

/**
 * Delete a customer — returns the deleted customer's id for audit logging.
 */
const deleteCustomer = async (customerId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    const snapshot = { id: customer.id, channel_type: customer.channel_type };

    await customer.destroy();

    return { message: 'Customer deleted successfully', deletedSnapshot: snapshot };
};

/**
 * List customers for a shop with filters and server-side pagination.
 * Returns { data, total, page, pageSize } — never a bare array.
 */
const listCustomers = async (userId, shopId, filters = {}) => {
    await verifyShopAccess(userId, shopId);

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(filters.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;

    const whereClause = { shop_id: shopId };

    if (filters.search) {
        whereClause.name = { [Op.iLike]: `%${filters.search}%` };
    }

    if (filters.phone || filters.number) {
        whereClause.phone = { [Op.iLike]: `%${filters.phone || filters.number}%` };
    }

    // Email filter was previously accepted by validator but silently ignored
    if (filters.email) {
        whereClause.email = { [Op.iLike]: `%${filters.email}%` };
    }

    if (filters.channel_type) {
        whereClause.channel_type = filters.channel_type;
    }

    if (filters.start_date && filters.end_date) {
        whereClause.created_at = { [Op.between]: [filters.start_date, filters.end_date] };
    } else if (filters.start_date) {
        whereClause.created_at = { [Op.gte]: filters.start_date };
    } else if (filters.end_date) {
        whereClause.created_at = { [Op.lte]: filters.end_date };
    }

    const { count, rows } = await Customer.findAndCountAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
        limit: pageSize,
        offset
    });

    return { data: rows, total: count, page, pageSize };
};

/**
 * Find or create a customer by channel identifiers.
 * Uses Sequelize's atomic findOrCreate to prevent race conditions
 * when concurrent webhook events arrive for the same customer.
 */
const findOrCreateCustomerByChannel = async (userId, shopId, data) => {
    await verifyShopAccess(userId, shopId);

    const [customer, isNew] = await Customer.findOrCreate({
        where: {
            shop_id: shopId,
            channel_type: data.channel_type,
            channel_user_id: data.channel_user_id
        },
        defaults: {
            phone: data.phone || null,
            name: data.name || null,
            language_preference: data.language_preference || null,
            last_active: data.last_active || null,
            metadata: data.metadata || {}
        }
    });

    return { customer, isNew };
};

/**
 * Get customer by external ID and shop
 */
const getCustomerByExternalId = async (customerId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    return customer;
};

module.exports = {
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerById,
    listCustomers,
    verifyShopAccess,
    findOrCreateCustomerByChannel,
    getCustomerByExternalId
};
