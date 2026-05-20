'use strict';

/**
 * Migration: add use_count to faq_responses
 * Tracks how many times each FAQ has been matched by the AI.
 */
module.exports = {
    name: '20260320_005_add_faq_use_count',

    up: async (sequelize) => {
        const { DataTypes } = require('sequelize');
        const queryInterface = sequelize.getQueryInterface();
        await queryInterface.addColumn('faq_responses', 'use_count', {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        }).catch(() => {}); // Ignore if already exists
    },

    down: async (sequelize) => {
        const queryInterface = sequelize.getQueryInterface();
        await queryInterface.removeColumn('faq_responses', 'use_count').catch(() => {});
    }
};
