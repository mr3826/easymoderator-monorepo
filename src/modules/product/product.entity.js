const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Product = sequelize.define('Product', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    category_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'categories',
            key: 'id'
        },
        onDelete: 'SET NULL'
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sku: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    compare_at_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    cost_per_item: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    track_quantity: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    allow_backorder: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    low_stock_threshold: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    images: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    weight: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    weight_unit: {
        type: DataTypes.ENUM('kg', 'g', 'lb', 'oz'),
        defaultValue: 'kg'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    is_featured: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    tags: {
        type: DataTypes.JSON,
        defaultValue: []
    }
}, {
    tableName: 'products',
    underscored: true,
    timestamps: true
});

module.exports = Product;
