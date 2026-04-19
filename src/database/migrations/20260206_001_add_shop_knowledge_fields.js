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

    await sequelize.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS branding_rules JSONB DEFAULT '{}'`).catch(() => {});
    await sequelize.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS knowledge_faqs JSONB DEFAULT '[]'`).catch(() => {});
    await sequelize.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS knowledge_gaps JSONB DEFAULT '[]'`).catch(() => {});
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('shops', 'branding_rules').catch(() => {});
    await queryInterface.removeColumn('shops', 'knowledge_faqs').catch(() => {});
    await queryInterface.removeColumn('shops', 'knowledge_gaps').catch(() => {});
  }
};
