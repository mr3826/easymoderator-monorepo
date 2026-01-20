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

    // Create customer
    const customer = await Customer.create({
        shop_id: shopId,
        ...customerData
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

    // Update customer
    await customer.update(updateData);

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

    // Add email filter
    if (filters.email) {
        whereClause.email = { [Op.iLike]: `%${filters.email}%` };
    }

    // Add number filter
    if (filters.number) {
        whereClause.number = { [Op.iLike]: `%${filters.number}%` };
    }

    // Add channel filter
    if (filters.channel) {
        whereClause.channel = filters.channel;
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

module.exports = {
    createCustomer,
    updateCustomer,
    getCustomerById,
    listCustomers,
    verifyShopAccess
};
