'use strict';

/**
 * Migration: 20260816_002_default_channel_automation_draft
 *
 * This historical migration changed the legacy Page column from 'AI_ACTIVE' to
 * 'DRAFT'. The later business-level reply-mode migration supersedes that
 * compatibility default with 'MANUAL'; this file remains unchanged in the
 * migration history so existing databases can be inspected and rolled back in
 * the same order.
 *
 * Column default only. Existing rows are NOT rewritten. The legacy Page value
 * is not runtime authority; business-level automation_mode is resolved through
 * the canonical business reply-mode resolver.
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
