const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const Campaign = sequelize.define('Campaign', {
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
        type: DataTypes.STRING,
        allowNull: false
    },
    message_template: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    segment_filter: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: 'e.g. { minOrders: 2, paymentMethod: "COD" }'
    },
    status: {
        type: DataTypes.ENUM('draft', 'scheduled', 'running', 'completed', 'failed'),
        defaultValue: 'draft',
        allowNull: false
    },
    scheduled_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    total_recipients: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    sent_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    failed_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    tableName: 'campaigns',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['shop_id', 'status'] }
    ]
});

module.exports = Campaign;
