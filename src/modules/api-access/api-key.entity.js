const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ApiKey = sequelize.define('ApiKey', {
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
        type: DataTypes.STRING(255),
        allowNull: false
    },
    key_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'SHA-256 hex hash of the raw API key — never store plaintext'
    },
    last_4: {
        type: DataTypes.STRING(4),
        allowNull: false,
        comment: 'Last 4 characters of the raw key for display purposes'
    },
    scopes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: "Array of scope strings e.g. ['conversations:read', 'orders:read']"
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    last_used_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'api_keys',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['key_hash'], unique: true }
    ]
});

module.exports = ApiKey;
