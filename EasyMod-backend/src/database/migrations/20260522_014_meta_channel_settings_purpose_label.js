'use strict';

/**
 * Migration: 20260522_014_meta_channel_settings_purpose_label
 *
 * Phase 4 of the multi-channel identity rework. Adds a cosmetic, merchant-facing
 * label on meta_channel_settings so a shop can disambiguate multiple Pages or
 * Instagram accounts that all share the same shop context.
 *
 * Example values: "Sales", "Live selling", "Regional - Dhaka", "Wholesale".
 *
 * Scope:
 *   - Cosmetic ONLY. Does not change AI routing, persona, or product scope.
 *   - Per [[product-positioning]]: AI persona / products / branding / delivery /
 *     payments / knowledge are shop-scoped. Purpose label is the one thing that
 *     legitimately differentiates two channels of the same shop.
 *
 * Changes:
 *   ALTER TABLE meta_channel_settings ADD COLUMN purpose_label VARCHAR(64) NULL
 */

module.exports = {
    name: '20260522_014_meta_channel_settings_purpose_label',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channel_settings
            ADD COLUMN IF NOT EXISTS purpose_label VARCHAR(64) NULL;
        `);
        console.log('[migration 014] Added meta_channel_settings.purpose_label (VARCHAR(64) NULL).');

        console.log('[migration] 20260522_014_meta_channel_settings_purpose_label: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE meta_channel_settings DROP COLUMN IF EXISTS purpose_label;
        `);
        console.log('[migration 014 DOWN] Dropped meta_channel_settings.purpose_label.');

        console.log('[migration] 20260522_014_meta_channel_settings_purpose_label: DOWN complete');
    }
};
