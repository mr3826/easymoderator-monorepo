const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const UserShop = sequelize.define('UserShop', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        }
    },
    role: {
        type: DataTypes.ENUM('owner', 'admin', 'staff'),
        allowNull: false,
        defaultValue: 'staff'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'user_shops',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['user_id', 'shop_id']
        }
    ]
});

module.exports = UserShop;
