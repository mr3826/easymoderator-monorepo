const { Customer, Shop, UserShop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { sequelize } = require('src/utils/database/database-setup');
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
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Duplicate detection logic
    const existing = await Customer.findOne({
        where: {
            shop_id: shopId,
            [Op.or]: [
                { phone: customerData.number || customerData.phone },
                { email: customerData.email }
            ]
        }
    });
    if (existing) throw new AppError('Duplicate customer detected', 409);

    // Map frontend field names to model field names
    const customer = await Customer.create({
        shop_id: shopId,
        name: customerData.name,
        phone: customerData.number || customerData.phone,
        channel_type: customerData.channel || customerData.channel_type || 'manual',
        channel_user_id: customerData.channel_user_id || customerData.number || customerData.phone || 'manual',
        language_preference: customerData.language_preference || null,
        metadata: customerData.metadata || {}
    });

    return customer;
};

/**
 * Update a customer
 */
const updateCustomer = async (customerId, userId, shopId, updateData) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Find customer
    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    // Map frontend field names to model field names
    const mappedData = { ...updateData };
    if (mappedData.number !== undefined) { mappedData.phone = mappedData.number; delete mappedData.number; }
    if (mappedData.channel !== undefined) { mappedData.channel_type = mappedData.channel; delete mappedData.channel; }
    await customer.update(mappedData);

    return customer;
};

/**
 * Get a single customer by ID
 */
const getCustomerById = async (customerId, userId, shopId) => {
    // Verify shop access
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
 * Delete a customer
 */
const deleteCustomer = async (customerId, userId, shopId) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Find customer
    const customer = await Customer.findOne({
        where: {
            id: customerId,
            shop_id: shopId
        }
    });

    if (!customer) {
        throw new AppError('Customer not found', 404);
    }

    // Delete customer
    await customer.destroy();

    return { message: 'Customer deleted successfully' };
};

/**
 * List all customers for a shop with filters
 */
const listCustomers = async (userId, shopId, filters = {}) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Build where clause
    const whereClause = {
        shop_id: shopId
    };

    // Add search filter (search in name)
    if (filters.search) {
        whereClause.name = { [Op.iLike]: `%${filters.search}%` };
    }

    // Add phone filter
    if (filters.phone) {
        whereClause.phone = { [Op.iLike]: `%${filters.phone}%` };
    }

    // Add channel filter
    if (filters.channel_type) {
        whereClause.channel_type = filters.channel_type;
    }

    // Add date range filter
    if (filters.start_date && filters.end_date) {
        whereClause.created_at = {
            [Op.between]: [filters.start_date, filters.end_date]
        };
    } else if (filters.start_date) {
        whereClause.created_at = {
            [Op.gte]: filters.start_date
        };
    } else if (filters.end_date) {
        whereClause.created_at = {
            [Op.lte]: filters.end_date
        };
    }

    // Get all customers with filters
    const customers = await Customer.findAll({
        where: whereClause,
        order: [
            ['created_at', 'DESC']
        ]
    });

    return customers;
};

/**
 * Find or create a customer by channel identifiers
 */
const findOrCreateCustomerByChannel = async (userId, shopId, data) => {
    await verifyShopAccess(userId, shopId);

    const existing = await Customer.findOne({
        where: {
            shop_id: shopId,
            channel_type: data.channel_type,
            channel_user_id: data.channel_user_id
        }
    });

    if (existing) {
        return { customer: existing, isNew: false };
    }

    const customer = await Customer.create({
        shop_id: shopId,
        phone: data.phone,
        name: data.name || null,
        channel_type: data.channel_type,
        channel_user_id: data.channel_user_id,
        language_preference: data.language_preference || null,
        last_active: data.last_active || null,
        metadata: data.metadata || {}
    });

    return { customer, isNew: true };
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
