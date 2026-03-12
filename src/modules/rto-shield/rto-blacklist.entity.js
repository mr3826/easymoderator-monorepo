const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const RtoBlacklist = sequelize.define('RtoBlacklist', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Normalized BD phone number (01XXXXXXXXX format)'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Reason for blacklisting (e.g. "fake COD order", "repeated RTO")'
  },
  risk_score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 80,
    comment: '0-100 risk score; 70+ is flagged, 90+ is auto-blocked'
  },
  is_global: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'True = visible to all tenants as a shared fraud signal'
  },
  shop_id: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'NULL when is_global = true'
  },
  added_by: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'User ID who added the entry'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'rto_blacklist',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = RtoBlacklist;
