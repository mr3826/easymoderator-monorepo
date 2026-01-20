const { Category, Shop, UserShop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { sequelize } = require('src/utils/database/database-setup');

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
 * Create a new category with optional subcategories
 */
const createCategory = async (userId, shopId, categoryData) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    const transaction = await sequelize.transaction();

    try {
        const { subcategories, ...mainCategoryData } = categoryData;

        // Create main category
        const category = await Category.create({
            shop_id: shopId,
            parent_category_id: null,
            ...mainCategoryData
        }, { transaction });

        // Create subcategories if provided
        if (subcategories && subcategories.length > 0) {
            const subcategoryPromises = subcategories.map(subcat =>
                Category.create({
                    shop_id: shopId,
                    parent_category_id: category.id,
                    ...subcat
                }, { transaction })
            );

            await Promise.all(subcategoryPromises);
        }

        await transaction.commit();

        // Fetch the created category with subcategories
        return await getCategoryById(category.id, userId, shopId);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Update a category and manage subcategories
 */
const updateCategory = async (categoryId, userId, shopId, updateData) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    const transaction = await sequelize.transaction();

    try {
        // Find category
        const category = await Category.findOne({
            where: {
                id: categoryId,
                shop_id: shopId
            }
        });

        if (!category) {
            throw new AppError('Category not found', 404);
        }

        const { subcategories, ...mainCategoryData } = updateData;

        // Update main category
        await category.update(mainCategoryData, { transaction });

        // Handle subcategories if provided
        if (subcategories && Array.isArray(subcategories)) {
            for (const subcat of subcategories) {
                if (subcat.id) {
                    // Update existing subcategory
                    const existingSubcat = await Category.findOne({
                        where: {
                            id: subcat.id,
                            parent_category_id: categoryId,
                            shop_id: shopId
                        }
                    });

                    if (existingSubcat) {
                        await existingSubcat.update(subcat, { transaction });
                    }
                } else {
                    // Create new subcategory
                    await Category.create({
                        shop_id: shopId,
                        parent_category_id: categoryId,
                        ...subcat
                    }, { transaction });
                }
            }
        }

        await transaction.commit();

        // Fetch updated category with subcategories
        return await getCategoryById(categoryId, userId, shopId);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Delete a category (will cascade delete subcategories)
 */
const deleteCategory = async (categoryId, userId, shopId) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Find category
    const category = await Category.findOne({
        where: {
            id: categoryId,
            shop_id: shopId
        }
    });

    if (!category) {
        throw new AppError('Category not found', 404);
    }

    // Delete category (will cascade to subcategories)
    await category.destroy();

    return { message: 'Category deleted successfully' };
};

/**
 * Get a single category by ID with subcategories
 */
const getCategoryById = async (categoryId, userId, shopId) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    const category = await Category.findOne({
        where: {
            id: categoryId,
            shop_id: shopId
        },
        include: [{
            model: Category,
            as: 'subcategories',
            where: { is_active: true },
            required: false
        }]
    });

    if (!category) {
        throw new AppError('Category not found', 404);
    }

    return category;
};

/**
 * List all categories for a shop with hierarchical structure
 */
const listCategories = async (userId, shopId, searchQuery = null) => {
    // Verify shop access
    await verifyShopAccess(userId, shopId);

    // Build where clause for search
    const whereClause = {
        shop_id: shopId,
        parent_category_id: null,
        is_active: true
    };

    // Add search filter if provided
    if (searchQuery) {
        whereClause.name = {
            [require('sequelize').Op.iLike]: `%${searchQuery}%`
        };
    }

    // Get all root categories (no parent) with their subcategories
    const categories = await Category.findAll({
        where: whereClause,
        include: [{
            model: Category,
            as: 'subcategories',
            where: { is_active: true },
            required: false
        }],
        order: [
            ['created_at', 'DESC'],
            [{ model: Category, as: 'subcategories' }, 'created_at', 'DESC']
        ]
    });

    return categories;
};

module.exports = {
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryById,
    listCategories,
    verifyShopAccess
};
