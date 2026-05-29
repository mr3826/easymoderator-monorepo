const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const CustomerPreference = sequelize.define('CustomerPreference', {
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
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'customers',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    preferred_payment: {
        type: DataTypes.ENUM('COD', 'bKash', 'Nagad', 'online'),
        allowNull: true
    },
    preferred_size: {
        type: DataTypes.STRING,
        allowNull: true
    },
    delivery_zone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    total_orders: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_spent: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0
    },
    last_ordered_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'customer_preferences',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'customer_id']
        }
    ]
});

module.exports = CustomerPreference;
