'use strict';

/**
 * Migration: 20260522_008_convert_enums
 *
 * Converts four VARCHAR columns to their proper ENUM types.
 * All conversions are idempotent — each step checks pg_type / data_type before acting.
 *
 * Entities covered:
 *   1. user_shops.role         VARCHAR → ENUM('owner','admin','staff')
 *   2. order_returns.status    VARCHAR → ENUM('pending_approval','approved','rejected')
 *   3. subscriptions.status    VARCHAR → ENUM('active','inactive','cancelled','suspended')
 *   4. known_areas.zone_type   VARCHAR → enum_known_areas_zone_type  (type created in 006)
 *
 * Safe pattern per column:
 *   a. Create ENUM type if not exists (DO block)
 *   b. Clamp any out-of-set values to a safe default and log the count
 *   c. ALTER TABLE … ALTER COLUMN … TYPE <enum> USING column::text::<enum>
 *      — guarded so it only runs when data_type is still 'character varying'
 */

module.exports = {
    name: '20260522_008_convert_enums',

    up: async (sequelize) => {

        // ── 1. user_shops.role ────────────────────────────────────────────────────
        // Entity: ENUM('owner','admin','staff')
        // Squash had VARCHAR — values 'manager' and 'staff' both possible in old data
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_user_shops_role') THEN
                    CREATE TYPE enum_user_shops_role AS ENUM ('owner', 'admin', 'staff');
                END IF;
            END $$;
        `);

        // Clamp out-of-set values (e.g. 'manager') to 'staff'
        const [userShopsFixed] = await sequelize.query(`
            WITH clamped AS (
                UPDATE user_shops
                SET role = 'staff'
                WHERE role NOT IN ('owner', 'admin', 'staff')
                RETURNING id
            )
            SELECT COUNT(*) AS cnt FROM clamped;
        `);
        const userShopsCount = parseInt(userShopsFixed[0].cnt, 10);
        if (userShopsCount > 0) {
            console.log(`[migration 008] user_shops.role: clamped ${userShopsCount} out-of-set rows to 'staff'`);
        }

        // Convert column only if still VARCHAR
        const [userShopsCol] = await sequelize.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'user_shops' AND column_name = 'role';
        `);
        if (userShopsCol.length > 0 && userShopsCol[0].data_type === 'character varying') {
            await sequelize.query(`
                ALTER TABLE user_shops
                ALTER COLUMN role TYPE enum_user_shops_role
                USING role::text::enum_user_shops_role;
            `);
            console.log('[migration 008] user_shops.role: converted to ENUM');
        } else {
            console.log('[migration 008] user_shops.role: already ENUM, skip');
        }

        // ── 2. order_returns.status ───────────────────────────────────────────────
        // Entity: ENUM('pending_approval','approved','rejected')
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_order_returns_status') THEN
                    CREATE TYPE enum_order_returns_status AS ENUM ('pending_approval', 'approved', 'rejected');
                END IF;
            END $$;
        `);

        // Clamp — old squash had 'requested','completed','cancelled' which are not in entity set
        const [returnsFixed] = await sequelize.query(`
            WITH clamped AS (
                UPDATE order_returns
                SET status = 'pending_approval'
                WHERE status NOT IN ('pending_approval', 'approved', 'rejected')
                RETURNING id
            )
            SELECT COUNT(*) AS cnt FROM clamped;
        `);
        const returnsCount = parseInt(returnsFixed[0].cnt, 10);
        if (returnsCount > 0) {
            console.log(`[migration 008] order_returns.status: clamped ${returnsCount} out-of-set rows to 'pending_approval'`);
        }

        const [returnsCol] = await sequelize.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'order_returns' AND column_name = 'status';
        `);
        if (returnsCol.length > 0 && returnsCol[0].data_type === 'character varying') {
            await sequelize.query(`
                ALTER TABLE order_returns
                ALTER COLUMN status TYPE enum_order_returns_status
                USING status::text::enum_order_returns_status;
            `);
            console.log('[migration 008] order_returns.status: converted to ENUM');
        } else {
            console.log('[migration 008] order_returns.status: already ENUM, skip');
        }

        // ── 3. subscriptions.status ───────────────────────────────────────────────
        // Entity: ENUM('active','inactive','cancelled','suspended')
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_subscriptions_status') THEN
                    CREATE TYPE enum_subscriptions_status AS ENUM ('active', 'inactive', 'cancelled', 'suspended');
                END IF;
            END $$;
        `);

        // Clamp — task description mentioned 'past_due','paused','trialing' which are not in entity
        const [subsFixed] = await sequelize.query(`
            WITH clamped AS (
                UPDATE subscriptions
                SET status = 'active'
                WHERE status NOT IN ('active', 'inactive', 'cancelled', 'suspended')
                RETURNING id
            )
            SELECT COUNT(*) AS cnt FROM clamped;
        `);
        const subsCount = parseInt(subsFixed[0].cnt, 10);
        if (subsCount > 0) {
            console.log(`[migration 008] subscriptions.status: clamped ${subsCount} out-of-set rows to 'active'`);
        }

        const [subsCol] = await sequelize.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'subscriptions' AND column_name = 'status';
        `);
        if (subsCol.length > 0 && subsCol[0].data_type === 'character varying') {
            await sequelize.query(`
                ALTER TABLE subscriptions
                ALTER COLUMN status TYPE enum_subscriptions_status
                USING status::text::enum_subscriptions_status;
            `);
            console.log('[migration 008] subscriptions.status: converted to ENUM');
        } else {
            console.log('[migration 008] subscriptions.status: already ENUM, skip');
        }

        // ── 4. known_areas.zone_type ──────────────────────────────────────────────
        // ENUM type enum_known_areas_zone_type was created in migration 006.
        // Values: 'inside_city', 'outside_city', 'suburban'
        // Column is still VARCHAR — complete the conversion here.
        // (DO block is idempotent in case 006 is somehow missing)
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_known_areas_zone_type') THEN
                    CREATE TYPE enum_known_areas_zone_type AS ENUM ('inside_city', 'outside_city', 'suburban');
                END IF;
            END $$;
        `);

        const [knownAreasFixed] = await sequelize.query(`
            WITH clamped AS (
                UPDATE known_areas
                SET zone_type = 'inside_city'
                WHERE zone_type NOT IN ('inside_city', 'outside_city', 'suburban')
                RETURNING id
            )
            SELECT COUNT(*) AS cnt FROM clamped;
        `);
        const knownAreasCount = parseInt(knownAreasFixed[0].cnt, 10);
        if (knownAreasCount > 0) {
            console.log(`[migration 008] known_areas.zone_type: clamped ${knownAreasCount} out-of-set rows to 'inside_city'`);
        }

        const [knownAreasCol] = await sequelize.query(`
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'known_areas' AND column_name = 'zone_type';
        `);
        if (knownAreasCol.length > 0 && knownAreasCol[0].data_type === 'character varying') {
            await sequelize.query(`
                ALTER TABLE known_areas
                ALTER COLUMN zone_type TYPE enum_known_areas_zone_type
                USING zone_type::text::enum_known_areas_zone_type;
            `);
            console.log('[migration 008] known_areas.zone_type: converted to ENUM');
        } else {
            console.log('[migration 008] known_areas.zone_type: already ENUM, skip');
        }

        console.log('[migration] 20260522_008_convert_enums: UP complete');
    },

    down: async (sequelize) => {
        // known_areas.zone_type back to VARCHAR
        const [kaCol] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'known_areas' AND column_name = 'zone_type';
        `);
        if (kaCol.length > 0 && kaCol[0].data_type !== 'character varying') {
            await sequelize.query(`
                ALTER TABLE known_areas
                ALTER COLUMN zone_type TYPE VARCHAR(50)
                USING zone_type::text;
            `);
        }
        // Note: do NOT drop enum_known_areas_zone_type — it was created in 006 and owned by that migration's down.

        // subscriptions.status back to VARCHAR
        const [subCol] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'subscriptions' AND column_name = 'status';
        `);
        if (subCol.length > 0 && subCol[0].data_type !== 'character varying') {
            await sequelize.query(`
                ALTER TABLE subscriptions
                ALTER COLUMN status TYPE VARCHAR(50)
                USING status::text;
            `);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_subscriptions_status;`);

        // order_returns.status back to VARCHAR
        const [retCol] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'order_returns' AND column_name = 'status';
        `);
        if (retCol.length > 0 && retCol[0].data_type !== 'character varying') {
            await sequelize.query(`
                ALTER TABLE order_returns
                ALTER COLUMN status TYPE VARCHAR(50)
                USING status::text;
            `);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_order_returns_status;`);

        // user_shops.role back to VARCHAR
        const [usCol] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'user_shops' AND column_name = 'role';
        `);
        if (usCol.length > 0 && usCol[0].data_type !== 'character varying') {
            await sequelize.query(`
                ALTER TABLE user_shops
                ALTER COLUMN role TYPE VARCHAR(50)
                USING role::text;
            `);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_user_shops_role;`);

        console.log('[migration] 20260522_008_convert_enums: DOWN complete');
    }
};
