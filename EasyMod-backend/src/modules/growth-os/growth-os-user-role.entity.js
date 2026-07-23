'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const { GROWTH_OS_ROLES } = require('./growth-os.permissions');

const GrowthOsUserRole = sequelize.define('GrowthOsUserRole', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  role: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: {
      isIn: [Object.values(GROWTH_OS_ROLES)],
    },
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  granted_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  granted_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  revoked_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  revoked_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
  },
}, {
  tableName: 'growth_os_user_roles',
  underscored: true,
  timestamps: true,
});

module.exports = GrowthOsUserRole;
