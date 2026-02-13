const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const SupportTicket = sequelize.define('SupportTicket', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    ticket_number: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    tenant_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    conversation_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    priority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
        defaultValue: 'low'
    },
    category: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'),
        defaultValue: 'open'
    },
    assigned_to: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'support_tickets',
    underscored: true,
    timestamps: true
});

module.exports = SupportTicket;
