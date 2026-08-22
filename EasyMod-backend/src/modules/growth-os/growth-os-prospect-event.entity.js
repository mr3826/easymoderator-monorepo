'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const { PROSPECT_EVENT_TYPES } = require('./growth-os.prospect.lifecycle');

const GrowthOsProspectEvent = sequelize.define('GrowthOsProspectEvent', {
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
  event_type: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [PROSPECT_EVENT_TYPES] },
  },
  actor_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  from_value: { type: DataTypes.STRING(64), allowNull: true },
  to_value: { type: DataTypes.STRING(64), allowNull: true },
  reason: { type: DataTypes.STRING(200), allowNull: true },
  changed_fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'growth_os_prospect_events',
  underscored: true,
  timestamps: false,
  indexes: [
    {
      name: 'growth_os_prospect_events_prospect_created_idx',
      fields: ['prospect_id', { name: 'created_at', order: 'DESC' }],
    },
  ],
});

module.exports = GrowthOsProspectEvent;
