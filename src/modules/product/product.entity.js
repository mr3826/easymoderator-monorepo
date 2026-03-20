const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

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
    sku: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    quantity: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    low_stock_threshold: {
        type: DataTypes.INTEGER,
        defaultValue: 5
    },
    track_quantity: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    weight: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    weight_unit: {
        type: DataTypes.STRING(10),
        defaultValue: 'kg'
    },
    brand: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    tags: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },
    images: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },
    aliases: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },
    variants: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },
    compare_at_price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    cost_per_item: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    allow_discounts: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    charge_tax: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    send_low_stock_alert: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    in_stock: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },

    // ---------------------------------------------------------------------------
    // AI analysis columns — set at upload time by vision LLM, used for search
    // only. Live product facts (price, quantity, in_stock) are always read
    // from the fields above — never from ai_* columns.
    // ---------------------------------------------------------------------------
    ai_description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ai_tags: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: []
    },
    ai_category: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    ai_color_primary: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    ai_material: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    ai_attributes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {}
    },
    ai_search_text: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ai_processed_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'products',
    underscored: true,
    timestamps: true,
    paranoid: true // Enable soft delete
    // Note: unique index on (shop_id, sku) removed — add back via migration
    // once sku data is validated and existing rows are updated
});

module.exports = Product;
