const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const IdempotencyKey = sequelize.define('IdempotencyKey', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    // No field-level unique: true — uniqueness is enforced by the composite
    // index (idempotency_key, shop_id) below, which is tenant-scoped.
    idempotency_key: {
        type: DataTypes.STRING,
        allowNull: false
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
    endpoint: {
        type: DataTypes.STRING,
        allowNull: false
    },
    method: {
        type: DataTypes.ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
        allowNull: false
    },
    request_hash: {
        type: DataTypes.STRING,
        allowNull: false
    },
    response_data: {
        type: DataTypes.JSON,
        allowNull: true
    },
    status_code: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'idempotency_keys',
    underscored: true,
    timestamps: false,
    indexes: [
        // Tenant-scoped unique: Shop A's key "abc" does not collide with Shop B's "abc"
        {
            fields: ['idempotency_key', 'shop_id'],
            unique: true,
            name: 'idx_idempotency_shop_key'
        },
        { fields: ['expires_at'] }
    ]
});

// Add method to clean up expired keys
IdempotencyKey.cleanupExpired = async function() {
    const { Op } = require('sequelize');
    return await this.destroy({
        where: {
            expires_at: {
                [Op.lt]: new Date()
            }
        }
    });
};

module.exports = IdempotencyKey;
