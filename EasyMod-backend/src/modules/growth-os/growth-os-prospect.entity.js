'use strict';

const { Op, DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const { PROSPECT_STATUSES, PROSPECT_SOURCES } = require('./growth-os.prospect.lifecycle');

const GrowthOsProspect = sequelize.define('GrowthOsProspect', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  business_name: { type: DataTypes.STRING(255), allowNull: false },
  contact_name: { type: DataTypes.STRING(255), allowNull: true },
  contact_phone: { type: DataTypes.STRING(32), allowNull: true },
  contact_email: { type: DataTypes.STRING(255), allowNull: true },
  page_url: { type: DataTypes.TEXT, allowNull: true },
  niche: { type: DataTypes.STRING(120), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  normalized_business_name: { type: DataTypes.STRING(255), allowNull: false },
  normalized_phone: { type: DataTypes.STRING(32), allowNull: true },
  normalized_email: { type: DataTypes.STRING(255), allowNull: true },
  normalized_page: { type: DataTypes.STRING(255), allowNull: true },
  source: {
    type: DataTypes.STRING(32),
    allowNull: false,
    validate: { isIn: [PROSPECT_SOURCES] },
  },
  source_detail: { type: DataTypes.STRING(160), allowNull: true },
  source_reference: { type: DataTypes.STRING(255), allowNull: true },
  source_recorded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'new',
    validate: { isIn: [PROSPECT_STATUSES] },
  },
  status_changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  disqualified_reason: { type: DataTypes.STRING(200), allowNull: true },
  owner_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  assigned_at: { type: DataTypes.DATE, allowNull: true },
  assigned_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  linked_shop_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'shops', key: 'id' },
    onDelete: 'SET NULL',
  },
  linked_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  linked_at: { type: DataTypes.DATE, allowNull: true },
  merged_into_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'growth_os_prospects', key: 'id' },
    onDelete: 'SET NULL',
  },
  merged_at: { type: DataTypes.DATE, allowNull: true },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
}, {
  tableName: 'growth_os_prospects',
  underscored: true,
  timestamps: true,
  indexes: [
    { name: 'growth_os_prospects_status_created_idx', fields: [{ name: 'status' }, { name: 'created_at', order: 'DESC' }] },
    {
      name: 'growth_os_prospects_owner_status_created_idx',
      fields: ['owner_user_id', 'status', { name: 'created_at', order: 'DESC' }],
    },
    { name: 'growth_os_prospects_source_created_idx', fields: ['source', { name: 'created_at', order: 'DESC' }] },
    { name: 'growth_os_prospects_normalized_business_name_idx', fields: ['normalized_business_name'] },
    {
      name: 'growth_os_prospects_linked_shop_idx',
      fields: ['linked_shop_id'],
      where: { linked_shop_id: { [Op.ne]: null } },
    },
    {
      name: 'growth_os_prospects_merged_into_idx',
      fields: ['merged_into_id'],
      where: { merged_into_id: { [Op.ne]: null } },
    },
    {
      name: 'growth_os_prospects_normalized_phone_uq',
      unique: true,
      fields: ['normalized_phone'],
      where: {
        normalized_phone: { [Op.ne]: null },
        status: { [Op.ne]: 'merged' },
      },
    },
    {
      name: 'growth_os_prospects_normalized_email_uq',
      unique: true,
      fields: ['normalized_email'],
      where: {
        normalized_email: { [Op.ne]: null },
        status: { [Op.ne]: 'merged' },
      },
    },
    {
      name: 'growth_os_prospects_normalized_page_uq',
      unique: true,
      fields: ['normalized_page'],
      where: {
        normalized_page: { [Op.ne]: null },
        status: { [Op.ne]: 'merged' },
      },
    },
    {
      name: 'growth_os_prospects_source_reference_uq',
      unique: true,
      fields: ['source', 'source_reference'],
      where: {
        source_reference: { [Op.ne]: null },
        status: { [Op.ne]: 'merged' },
      },
    },
  ],
});

module.exports = GrowthOsProspect;
