'use strict';

/**
 * Migration: Add title/status to conversations
 */

module.exports = {
  name: '20260209_002_add_conversation_fields',

  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('conversations', 'title', {
      type: DataTypes.STRING(255),
      allowNull: true
    }).catch(() => {});

    await queryInterface.addColumn('conversations', 'status', {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active'
    }).catch(() => {});
  }
};
