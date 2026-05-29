const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const CustomerDeliveryStats = sequelize.define('CustomerDeliveryStats', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  shop_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  delivery_attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  rto_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  last_rto_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_delivered_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'customer_delivery_stats',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = CustomerDeliveryStats;
