'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ShopPickupLocation = sequelize.define('ShopPickupLocation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id',
        },
        onDelete: 'CASCADE',
    },
    display_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    contact_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    secondary_phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    city_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    zone_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    area_name: {
        type: DataTypes.STRING(120),
        allowNull: false,
    },
    postal_code: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    // Legacy aliases are nullable so existing callers can be migrated without
    // changing the pickup API contract.
    name: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    contact_phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    city: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    zone: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    area: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    city_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    zone_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    area_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    provider: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'manual',
    },
    provider_store_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
    is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        validate: {
            defaultRequiresActive(value) {
                if (value && this.is_active === false) {
                    throw new Error('An inactive pickup location cannot be the default');
                }
            },
        },
    },
    metadata: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
    },
}, {
    tableName: 'shop_pickup_locations',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'provider', 'provider_store_id'],
            name: 'shop_pickup_locations_provider_store_uq',
        },
        {
            fields: ['shop_id', 'is_active'],
            name: 'idx_shop_pickup_locations_shop_active',
        },
        {
            fields: ['shop_id', 'provider', 'provider_store_id'],
            name: 'idx_shop_pickup_locations_provider_store',
        },
        {
            unique: true,
            fields: ['shop_id'],
            where: { is_default: true },
            name: 'idx_shop_pickup_locations_one_default',
        },
    ],
});

module.exports = ShopPickupLocation;
