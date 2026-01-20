const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Shop = sequelize.define('Shop', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    unique_code: {
        type: DataTypes.STRING(6),
        allowNull: false,
        unique: true
    },
    shop_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    address: {
        type: DataTypes.STRING,
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    opening_hours: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_areas: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    payment_methods: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    logo: {
        type: DataTypes.STRING,
        allowNull: true
    },
    banner_image: {
        type: DataTypes.STRING,
        allowNull: true
    },
    shop_images: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    }
}, {
    tableName: 'shops',
    underscored: true,
    timestamps: true
});

module.exports = Shop;
