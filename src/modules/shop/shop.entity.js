const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Shop = sequelize.define('Shop', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    unique_code: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    tenant_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'tenants',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    shop_name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    timezone: {
        type: DataTypes.STRING(50),
        defaultValue: 'Asia/Dhaka'
    },
    business_hours: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
            start: '09:00',
            end: '22:00',
            days: [0, 1, 2, 3, 4, 5, 6]
        }
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    }
    ,
    config_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    }
}, {
    tableName: 'shops',
    underscored: true,
    timestamps: true
});

module.exports = Shop;
