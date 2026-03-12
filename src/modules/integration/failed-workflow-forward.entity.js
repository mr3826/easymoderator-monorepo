const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const FailedWorkflowForward = sequelize.define('FailedWorkflowForward', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  shop_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  platform: {
    type: DataTypes.STRING,
    allowNull: false
  },
  event_data: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'JSON-stringified event payload'
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  attempt: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  resolved: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'failed_workflow_forwards',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = FailedWorkflowForward;
