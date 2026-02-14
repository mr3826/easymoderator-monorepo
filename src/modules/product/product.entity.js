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
    name: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    name_bn: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    category: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    description_bn: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    image_url: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    in_stock: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    sku: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    track_quantity: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    low_stock_threshold: {
        type: DataTypes.INTEGER,
        defaultValue: 5
    },
    send_low_stock_alert: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    allow_discounts: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    charge_tax: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    variants: {
        type: DataTypes.JSONB,
        defaultValue: []
    },
    brand: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    weight: {
        type: DataTypes.DECIMAL(10, 3),
        allowNull: true
    },
    weight_unit: {
        type: DataTypes.STRING(10),
        allowNull: true
    },
    compare_at_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    cost_per_item: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
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
    embedding: {
        type: DataTypes.ARRAY(DataTypes.FLOAT),
        allowNull: true
    },
    tags: {
        type: DataTypes.JSONB,
        defaultValue: []
    }
}, {
    tableName: 'products',
    underscored: true,
    timestamps: true
});

module.exports = Product;
