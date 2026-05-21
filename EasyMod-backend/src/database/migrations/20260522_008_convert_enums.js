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
 * PostgreSQL requires:
 *   When a VARCHAR column has a DEFAULT, you must DROP DEFAULT before ALTER TYPE,
 *   then restore it after. The ::text:: cast is needed for the USING clause.
 *   Pattern per column:
 *     a. CREATE TYPE IF NOT EXISTS
 *     b. Clamp out-of-set values with UPDATE + log count
 *     c. DROP DEFAULT (column may not have one, use DO block to check)
 *     d. ALTER COLUMN TYPE new_enum USING column::text::new_enum
 *     e. Restore ALTER COLUMN SET DEFAULT 'value'::new_enum  (if applicable)
 *   Guard: only run ALTER if column data_type is still 'character varying'
 */

module.exports = {
    name: '20260522_008_convert_enums',

    up: async (sequelize) => {

        // Helper: check current column data_type (table/col are migration-hardcoded, safe to inline)
        const getColType = async (table, col) => {
            const [rows] = await sequelize.query(
                `SELECT data_type FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${col}';`
            );
            return rows.length > 0 ? rows[0].data_type : null;
        };

        // ── 1. user_shops.role ────────────────────────────────────────────────────
        // Entity: ENUM('owner','admin','staff'), defaultValue: 'staff'
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

        if ((await getColType('user_shops', 'role')) === 'character varying') {
            // Drop default before altering type, then restore
            await sequelize.query(`ALTER TABLE user_shops ALTER COLUMN role DROP DEFAULT;`);
            await sequelize.query(`
                ALTER TABLE user_shops
                ALTER COLUMN role TYPE enum_user_shops_role
                USING role::text::enum_user_shops_role;
            `);
            await sequelize.query(`ALTER TABLE user_shops ALTER COLUMN role SET DEFAULT 'staff'::enum_user_shops_role;`);
            console.log('[migration 008] user_shops.role: converted to ENUM (default restored)');
        } else {
            console.log('[migration 008] user_shops.role: already ENUM, skip');
        }

        // ── 2. order_returns.status ───────────────────────────────────────────────
        // Entity: ENUM('pending_approval','approved','rejected'), defaultValue: 'pending_approval'
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

        if ((await getColType('order_returns', 'status')) === 'character varying') {
            await sequelize.query(`ALTER TABLE order_returns ALTER COLUMN status DROP DEFAULT;`);
            await sequelize.query(`
                ALTER TABLE order_returns
                ALTER COLUMN status TYPE enum_order_returns_status
                USING status::text::enum_order_returns_status;
            `);
            await sequelize.query(`ALTER TABLE order_returns ALTER COLUMN status SET DEFAULT 'pending_approval'::enum_order_returns_status;`);
            console.log('[migration 008] order_returns.status: converted to ENUM (default restored)');
        } else {
            console.log('[migration 008] order_returns.status: already ENUM, skip');
        }

        // ── 3. subscriptions.status ───────────────────────────────────────────────
        // Entity: ENUM('active','inactive','cancelled','suspended'), defaultValue: 'active'
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

        if ((await getColType('subscriptions', 'status')) === 'character varying') {
            await sequelize.query(`ALTER TABLE subscriptions ALTER COLUMN status DROP DEFAULT;`);
            await sequelize.query(`
                ALTER TABLE subscriptions
                ALTER COLUMN status TYPE enum_subscriptions_status
                USING status::text::enum_subscriptions_status;
            `);
            await sequelize.query(`ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'active'::enum_subscriptions_status;`);
            console.log('[migration 008] subscriptions.status: converted to ENUM (default restored)');
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

        if ((await getColType('known_areas', 'zone_type')) === 'character varying') {
            // zone_type has no DEFAULT in the entity (allowNull: false, no defaultValue)
            // Attempt DROP DEFAULT idempotently (it may or may not have one from squash)
            await sequelize.query(`ALTER TABLE known_areas ALTER COLUMN zone_type DROP DEFAULT;`).catch(() => {});
            await sequelize.query(`
                ALTER TABLE known_areas
                ALTER COLUMN zone_type TYPE enum_known_areas_zone_type
                USING zone_type::text::enum_known_areas_zone_type;
            `);
            // No default to restore per entity definition
            console.log('[migration 008] known_areas.zone_type: converted to ENUM');
        } else {
            console.log('[migration 008] known_areas.zone_type: already ENUM, skip');
        }

        console.log('[migration] 20260522_008_convert_enums: UP complete');
    },

    down: async (sequelize) => {
        // known_areas.zone_type back to VARCHAR
        const [kaType] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'known_areas' AND column_name = 'zone_type';
        `);
        if (kaType.length > 0 && kaType[0].data_type !== 'character varying') {
            await sequelize.query(`ALTER TABLE known_areas ALTER COLUMN zone_type DROP DEFAULT;`).catch(() => {});
            await sequelize.query(`
                ALTER TABLE known_areas
                ALTER COLUMN zone_type TYPE VARCHAR(50)
                USING zone_type::text;
            `);
        }
        // Note: do NOT drop enum_known_areas_zone_type — it was created in 006 and owned by that migration's down.

        // subscriptions.status back to VARCHAR
        const [subType] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'subscriptions' AND column_name = 'status';
        `);
        if (subType.length > 0 && subType[0].data_type !== 'character varying') {
            await sequelize.query(`ALTER TABLE subscriptions ALTER COLUMN status DROP DEFAULT;`).catch(() => {});
            await sequelize.query(`
                ALTER TABLE subscriptions
                ALTER COLUMN status TYPE VARCHAR(50)
                USING status::text;
            `);
            await sequelize.query(`ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'active';`);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_subscriptions_status;`);

        // order_returns.status back to VARCHAR
        const [retType] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'order_returns' AND column_name = 'status';
        `);
        if (retType.length > 0 && retType[0].data_type !== 'character varying') {
            await sequelize.query(`ALTER TABLE order_returns ALTER COLUMN status DROP DEFAULT;`).catch(() => {});
            await sequelize.query(`
                ALTER TABLE order_returns
                ALTER COLUMN status TYPE VARCHAR(50)
                USING status::text;
            `);
            await sequelize.query(`ALTER TABLE order_returns ALTER COLUMN status SET DEFAULT 'pending_approval';`);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_order_returns_status;`);

        // user_shops.role back to VARCHAR
        const [usType] = await sequelize.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = 'user_shops' AND column_name = 'role';
        `);
        if (usType.length > 0 && usType[0].data_type !== 'character varying') {
            await sequelize.query(`ALTER TABLE user_shops ALTER COLUMN role DROP DEFAULT;`).catch(() => {});
            await sequelize.query(`
                ALTER TABLE user_shops
                ALTER COLUMN role TYPE VARCHAR(50)
                USING role::text;
            `);
            await sequelize.query(`ALTER TABLE user_shops ALTER COLUMN role SET DEFAULT 'staff';`);
        }
        await sequelize.query(`DROP TYPE IF EXISTS enum_user_shops_role;`);

        console.log('[migration] 20260522_008_convert_enums: DOWN complete');
    }
};
