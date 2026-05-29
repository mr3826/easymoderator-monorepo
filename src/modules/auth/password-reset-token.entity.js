const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const PasswordResetToken = sequelize.define('PasswordResetToken', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    used_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    },
}, {
    tableName: 'password_reset_tokens',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
});

module.exports = PasswordResetToken;
