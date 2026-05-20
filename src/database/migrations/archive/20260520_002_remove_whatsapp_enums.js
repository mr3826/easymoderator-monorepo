/**
 * Migration: 20260520_002_remove_whatsapp_enums
 *
 * Phase 1 — Foundations: strip 'whatsapp' from ENUM columns.
 *
 * PostgreSQL does not support removing ENUM values directly.
 * The strategy for each ENUM is:
 *   1. DELETE any rows where the column = 'whatsapp' (defensive — should be 0)
 *   2. Create a new ENUM type without 'whatsapp'
 *   3. ALTER TABLE to use the new type (with USING cast)
 *   4. DROP the old type
 *
 * Affected tables/columns:
 *   - channel_configs.channel_type   (ENUM includes 'whatsapp')
 *   - meta_integrations.platform     (ENUM includes 'whatsapp')
 *   - customers.channel_type         (ENUM includes 'whatsapp')
 *
 * The down() migration re-adds 'whatsapp' to restore pre-migration state.
 * This is safe because we are NOT deleting WhatsApp code yet (Phase 5).
 */

'use strict';

module.exports = {
    name: '20260520_002_remove_whatsapp_enums',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') {
            console.warn('[migration] 20260520_002 skipped — requires PostgreSQL');
            return;
        }

        // ── Helper: recreate an ENUM type without a specific value ─────────────
        // Uses rename -> create-new -> alter-column -> drop-old pattern.
        async function removeEnumValue({ table, column, oldTypeName, newValues, newTypeName }) {
            // Step 1: Delete rows with the value being removed (defensive)
            const [deleted] = await sequelize.query(
                `SELECT COUNT(*) as cnt FROM ${table} WHERE ${column}::text = 'whatsapp'`
            );
            const count = parseInt(deleted[0].cnt, 10);
            if (count > 0) {
                console.warn(
                    `[migration] Found ${count} whatsapp row(s) in ${table}.${column} — deleting before enum removal`
                );
                await sequelize.query(
                    `DELETE FROM ${table} WHERE ${column}::text = 'whatsapp'`
                );
            }

            // Step 2: Rename old type to a backup name
            const backupName = oldTypeName + '_old';
            await sequelize.query(`ALTER TYPE ${oldTypeName} RENAME TO ${backupName};`);

            // Step 3: Create new type without 'whatsapp'
            const valueList = newValues.map(v => `'${v}'`).join(', ');
            await sequelize.query(`CREATE TYPE ${newTypeName} AS ENUM (${valueList});`);

            // Step 4: ALTER the column to use the new type
            await sequelize.query(`
                ALTER TABLE ${table}
                ALTER COLUMN ${column} TYPE ${newTypeName}
                USING ${column}::text::${newTypeName};
            `);

            // Step 5: Drop the old type
            await sequelize.query(`DROP TYPE ${backupName};`);

            console.log(`[migration] Removed 'whatsapp' from ${table}.${column}`);
        }

        // ── channel_configs.channel_type ───────────────────────────────────────
        // Check if the type exists before trying to alter it
        const [channelTypeExists] = await sequelize.query(`
            SELECT 1 FROM pg_type WHERE typname = 'enum_channel_configs_channel_type'
        `);
        if (channelTypeExists.length > 0) {
            await removeEnumValue({
                table: 'channel_configs',
                column: 'channel_type',
                oldTypeName: 'enum_channel_configs_channel_type',
                newTypeName: 'enum_channel_configs_channel_type',
                newValues: ['messenger', 'instagram', 'webchat', 'telegram', 'facebook'],
            });
        } else {
            console.warn('[migration] enum_channel_configs_channel_type not found — skipping');
        }

        // ── meta_integrations.platform ─────────────────────────────────────────
        const [metaPlatformExists] = await sequelize.query(`
            SELECT 1 FROM pg_type WHERE typname = 'enum_meta_integrations_platform'
        `);
        if (metaPlatformExists.length > 0) {
            await removeEnumValue({
                table: 'meta_integrations',
                column: 'platform',
                oldTypeName: 'enum_meta_integrations_platform',
                newTypeName: 'enum_meta_integrations_platform',
                newValues: ['facebook', 'instagram'],
            });
        } else {
            console.warn('[migration] enum_meta_integrations_platform not found — skipping');
        }

        // ── customers.channel_type ─────────────────────────────────────────────
        const [customerTypeExists] = await sequelize.query(`
            SELECT 1 FROM pg_type WHERE typname = 'enum_customers_channel_type'
        `);
        if (customerTypeExists.length > 0) {
            await removeEnumValue({
                table: 'customers',
                column: 'channel_type',
                oldTypeName: 'enum_customers_channel_type',
                newTypeName: 'enum_customers_channel_type',
                newValues: ['messenger', 'instagram', 'webchat', 'manual', 'facebook', 'telegram'],
            });
        } else {
            console.warn('[migration] enum_customers_channel_type not found — skipping');
        }

        console.log('[migration] 20260520_002_remove_whatsapp_enums: UP complete');
    },

    down: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') return;

        // Re-add 'whatsapp' to restore pre-migration state.
        // PostgreSQL supports ADD VALUE without the rename dance.
        async function addEnumValue(typeName, value) {
            await sequelize.query(`
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typeName}') THEN
                        ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS '${value}';
                    END IF;
                END $$;
            `);
        }

        await addEnumValue('enum_channel_configs_channel_type', 'whatsapp');
        await addEnumValue('enum_meta_integrations_platform', 'whatsapp');
        await addEnumValue('enum_customers_channel_type', 'whatsapp');

        console.log('[migration] 20260520_002_remove_whatsapp_enums: DOWN complete (whatsapp re-added to ENUMs)');
    }
};
