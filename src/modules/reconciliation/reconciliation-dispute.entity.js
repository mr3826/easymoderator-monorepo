const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ReconciliationDispute = sequelize.define('ReconciliationDispute', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  shop_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  collection_id: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'FK to courier_cod_collections; null for manually-created disputes'
  },
  provider: {
    type: DataTypes.STRING,
    allowNull: false
  },
  payment_reference: {
    type: DataTypes.STRING,
    allowNull: false
  },
  claimed_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  expected_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  discrepancy_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  dispute_status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'open',
    validate: { isIn: [['open', 'under_review', 'resolved', 'rejected']] }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolved_by: {
    type: DataTypes.UUID,
    allowNull: true
  }
}, {
  tableName: 'reconciliation_disputes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = ReconciliationDispute;
