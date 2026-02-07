'use strict';

/**
 * Migration: Add knowledge_documents to shops
 */

module.exports = {
  name: '20260206_002_add_shop_knowledge_documents',

  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('shops', 'knowledge_documents', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    }).catch(() => {});
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('shops', 'knowledge_documents').catch(() => {});
  }
};
