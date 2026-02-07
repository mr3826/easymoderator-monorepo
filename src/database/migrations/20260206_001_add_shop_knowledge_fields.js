'use strict';

/**
 * Migration: Add knowledge fields to shops
 * - branding_rules (JSON)
 * - knowledge_faqs (JSON)
 * - knowledge_gaps (JSON)
 */

module.exports = {
  name: '20260206_001_add_shop_knowledge_fields',

  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('shops', 'branding_rules', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    }).catch(() => {});

    await queryInterface.addColumn('shops', 'knowledge_faqs', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    }).catch(() => {});

    await queryInterface.addColumn('shops', 'knowledge_gaps', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    }).catch(() => {});
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('shops', 'branding_rules').catch(() => {});
    await queryInterface.removeColumn('shops', 'knowledge_faqs').catch(() => {});
    await queryInterface.removeColumn('shops', 'knowledge_gaps').catch(() => {});
  }
};
