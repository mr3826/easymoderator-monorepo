const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const DeliveryCost = sequelize.define('DeliveryCost', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
    zone_type: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    estimated_days: {
        type: DataTypes.INTEGER,
        defaultValue: 1
    }
}, {
    tableName: 'delivery_costs',
    underscored: true,
    timestamps: false
});

module.exports = DeliveryCost;
