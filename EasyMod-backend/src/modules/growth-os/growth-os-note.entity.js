'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const NOTE_TARGET_TYPES = Object.freeze(['prospect', 'user', 'shop']);

const GrowthOsNote = sequelize.define('GrowthOsNote', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  target_type: {
    type: DataTypes.STRING(16),
    allowNull: false,
    validate: { isIn: [NOTE_TARGET_TYPES] },
  },
  target_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  author_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { len: [1, 4000] },
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'growth_os_notes',
  underscored: true,
  timestamps: true,
  indexes: [
    {
      name: 'growth_os_notes_target_created_idx',
      fields: ['target_type', 'target_id', { name: 'created_at', order: 'DESC' }],
    },
    {
      name: 'growth_os_notes_author_idx',
      fields: ['author_user_id', { name: 'created_at', order: 'DESC' }],
    },
  ],
});

module.exports = GrowthOsNote;
module.exports.NOTE_TARGET_TYPES = NOTE_TARGET_TYPES;
