'use strict';

/**
 * Reconcile the fields introduced by the Shuru/Growth/Partner entity release.
 *
 * The 20260829 entity change added orders.metadata and subscriptions.usage_reset_at,
 * and renamed the legacy subscription attribute from threshold_conversations to
 * threshold_debt. 20260828_004 was already recorded in production and therefore
 * cannot be edited to repair those columns; this migration is the forward-only
 * repair.
 *
 * The legacy threshold column is retained when present. Its non-zero values are
 * copied once into threshold_debt so the attribute rename does not discard the
 * historical grace-buffer balance. No existing column or row is deleted.
 */

const hasColumn = async (sequelize, dialect, table, column, queryOptions) => {
    if (dialect === 'postgres') {
        const [rows] = await sequelize.query(`
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = '${table}'
               AND column_name = '${column}'
             LIMIT 1
        `, queryOptions);
        return rows.length > 0;
    }

    const [rows] = await sequelize.query(`PRAGMA table_info(${table});`, queryOptions);
    return rows.some((row) => row.name === column);
};

const applyRepair = async (sequelize, dialect, transaction) => {
    const postgres = dialect === 'postgres';
    const queryOptions = transaction ? { transaction } : undefined;
    const query = (sql) => sequelize.query(sql, queryOptions);
    const metadataType = postgres ? "JSONB DEFAULT '{}'::jsonb" : "TEXT DEFAULT '{}'";
    const usageResetType = postgres ? 'TIMESTAMPTZ' : 'DATETIME';
    const subscriptionsTable = postgres ? 'public.subscriptions' : 'subscriptions';

    if (postgres && transaction) {
        // The repair is small and should fail closed instead of waiting behind
        // a long-running application transaction. The advisory lock also
        // serializes concurrent copies of this repair on the same database.
        await query("SET LOCAL lock_timeout = '5s'");
        await query("SET LOCAL statement_timeout = '60s'");
        await query("SELECT pg_advisory_xact_lock(hashtext('easymod:20260901_001_reconcile_commercial_entity_drift'))");
    }

    // Capture both states before any DDL. If threshold_debt already existed,
    // a rerun must not overwrite an intentional zero with a legacy value.
    const hasLegacyThreshold = await hasColumn(
        sequelize,
        dialect,
        'subscriptions',
        'threshold_conversations',
        queryOptions,
    );
    const hadThresholdDebt = await hasColumn(
        sequelize,
        dialect,
        'subscriptions',
        'threshold_debt',
        queryOptions,
    );

    if (postgres) {
        await query(
            `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS metadata ${metadataType}`,
        );
        await query(
            'ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS threshold_debt INTEGER NOT NULL DEFAULT 0',
        );
        await query(
            `ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS usage_reset_at ${usageResetType}`,
        );
    } else {
        if (!(await hasColumn(sequelize, dialect, 'orders', 'metadata', queryOptions))) {
            await query(`ALTER TABLE orders ADD COLUMN metadata ${metadataType}`);
        }
        if (!hadThresholdDebt) {
            await query(
                'ALTER TABLE subscriptions ADD COLUMN threshold_debt INTEGER NOT NULL DEFAULT 0',
            );
        }
        if (!(await hasColumn(sequelize, dialect, 'subscriptions', 'usage_reset_at', queryOptions))) {
            await query(
                `ALTER TABLE subscriptions ADD COLUMN usage_reset_at ${usageResetType}`,
            );
        }
    }

    if (hasLegacyThreshold && !hadThresholdDebt) {
        // Only fill the newly-added/defaulted target. Re-applying the
        // migration must not overwrite a later operator/application value.
        await query(`
            UPDATE ${subscriptionsTable}
               SET threshold_debt = threshold_conversations
             WHERE threshold_debt = 0
               AND threshold_conversations IS NOT NULL
               AND threshold_conversations <> 0
        `);
    }
};

module.exports = {
    name: '20260901_001_reconcile_commercial_entity_drift',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        if (dialect === 'postgres' && typeof sequelize.transaction === 'function') {
            await sequelize.transaction(async (transaction) => {
                await applyRepair(sequelize, dialect, transaction);
            });
            return;
        }

        await applyRepair(sequelize, dialect);
    },

    down: async () => {
        // Dropping these columns would be destructive and could erase values
        // written after this repair. Schema rollback is intentionally blocked;
        // restore an isolated database backup or ship a reviewed forward fix.
        throw new Error(
            'Rollback blocked: 20260901_001 is an additive production repair; use database restore or a reviewed forward migration.',
        );
    },
};
