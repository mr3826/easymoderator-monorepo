'use strict';

/**
 * Migration: Add product fields for discounts, tax, and inventory
 * 
 * Purpose: Add missing fields to support full product functionality
 * - allow_discounts: Allow discounts on this product
 * - charge_tax: Apply tax to this product
 * - send_low_stock_alert: Send alerts when stock is low
 * - variants: Store product variant information
 * 
 * Backward Compatibility: YES
 * - Adds new columns with default values
 * - No changes to existing columns
 * - Safe to run on existing databases
 */

module.exports = {
  name: '20260202_001_add_product_fields',
  
  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    // Add allow_discounts column
    await queryInterface.addColumn('products', 'allow_discounts', {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: true
    }).catch(() => {}); // Ignore if already exists

    // Add charge_tax column
    await queryInterface.addColumn('products', 'charge_tax', {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: true
    }).catch(() => {}); // Ignore if already exists

    // Add send_low_stock_alert column
    await queryInterface.addColumn('products', 'send_low_stock_alert', {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: true
    }).catch(() => {}); // Ignore if already exists

    // Add variants column
    await queryInterface.addColumn('products', 'variants', {
      type: DataTypes.JSON,
      defaultValue: [],
      allowNull: true
    }).catch(() => {}); // Ignore if already exists
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();
    
    await queryInterface.removeColumn('products', 'allow_discounts').catch(() => {});
    await queryInterface.removeColumn('products', 'charge_tax').catch(() => {});
    await queryInterface.removeColumn('products', 'send_low_stock_alert').catch(() => {});
    await queryInterface.removeColumn('products', 'variants').catch(() => {});
  }
};

