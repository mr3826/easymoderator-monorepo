const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

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
    role: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'owner'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    is_verified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
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
    },
    token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    must_change_password: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    temporary_password_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    },
    // EasyModerator operator role. NULL = normal merchant user.
    // 'SUPPORT_ADMIN' (read-only) | 'SUPER_ADMIN' (read + mutate). Distinct from
    // the tenant user_shops.role (owner/admin/staff).
    platform_role: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: null
    }
}, {
    tableName: 'users',
    underscored: true,
    timestamps: true
});

module.exports = User;
