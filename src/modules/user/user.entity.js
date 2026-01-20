const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    full_name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    profile_picture: {
        type: DataTypes.STRING,
        allowNull: true
    },
    refresh_token: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    last_logged_shop_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'shops',
            key: 'id'
        }
    }
}, {
    tableName: 'users',
    underscored: true,
    timestamps: true
});

module.exports = User;
