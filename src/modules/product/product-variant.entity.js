/**
 * Bug #5: ProductVariant entity — proper relational table for product variants.
 *
 * Before this fix, variants were stored as a flat JSON array inside each
 * Product row (product.variants = ['Red', 'Blue']).  That makes it impossible
 * to track per-variant stock, price, or SKU.
 *
 * This table replaces the JSON blob.  Existing data is migrated by reading
 * product.variants and inserting a row per string entry.
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ProductVariant = sequelize.define('ProductVariant', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    product_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'products',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    // e.g. 'Color', 'Size', 'Material'
    option_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Variant'
    },
    // e.g. 'Red / XL', 'Blue / M'
    option_value: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    sku: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    // null means inherit parent product price
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    compare_at_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    // Arbitrary extra attributes (color hex, image URL, etc.)
    attributes: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    }
}, {
    tableName: 'product_variants',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['product_id'] },
        { fields: ['product_id', 'sku'], unique: true, where: { sku: { [require('sequelize').Op.ne]: null } } }
    ]
});

// Associations — loaded after Product to avoid circular dependency
const Product = require('./product.entity');
Product.hasMany(ProductVariant, { foreignKey: 'product_id', as: 'product_variants' });
ProductVariant.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

module.exports = ProductVariant;
