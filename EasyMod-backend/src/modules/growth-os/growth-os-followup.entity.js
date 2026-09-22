'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const FOLLOWUP_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);

const GrowthOsFollowup = sequelize.define('GrowthOsFollowup', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  prospect_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'growth_os_prospects', key: 'id' },
    onDelete: 'CASCADE',
  },
  owner_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  due_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  action: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: { notEmpty: true },
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: { len: [0, 2000] },
  },
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'open',
    validate: { isIn: [FOLLOWUP_STATUSES] },
  },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  completed_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
}, {
  tableName: 'growth_os_followups',
  underscored: true,
  timestamps: true,
  indexes: [
    {
      name: 'growth_os_followups_owner_open_due_idx',
      fields: ['owner_user_id', 'due_at'],
      where: { status: 'open' },
    },
    {
      name: 'growth_os_followups_prospect_open_idx',
      fields: ['prospect_id', 'due_at'],
      where: { status: 'open' },
    },
    {
      name: 'growth_os_followups_status_due_idx',
      fields: ['status', 'due_at'],
    },
  ],
});

module.exports = GrowthOsFollowup;
module.exports.FOLLOWUP_STATUSES = FOLLOWUP_STATUSES;
