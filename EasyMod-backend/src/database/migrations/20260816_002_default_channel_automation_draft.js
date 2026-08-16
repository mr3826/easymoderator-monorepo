'use strict';

/**
 * Migration: 20260816_002_default_channel_automation_draft
 *
 * meta_channel_settings.automation_mode defaulted to 'AI_ACTIVE' (squash line
 * 1002), so a Page connected without an explicit mode was created ready to
 * auto-send to real customers. DRAFT is the product default everywhere else —
 * shop-defaults.js DEFAULT_AI_SETTINGS, the frontend AISettingsForm, and now
 * meta-channel-settings.entity.js — this aligns the column with them.
 *
 * Column default only. Existing rows are NOT rewritten: a shop that deliberately
 * turned a Page on keeps its setting, and business-level automation_mode is
 * authoritative at read time anyway (message-worker.resolveEffectiveAiSettings).
 */

module.exports = {
    name: '20260816_002_default_channel_automation_draft',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channel_settings
            ALTER COLUMN automation_mode SET DEFAULT 'DRAFT';
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channel_settings
            ALTER COLUMN automation_mode SET DEFAULT 'AI_ACTIVE';
        `);
    },
};
