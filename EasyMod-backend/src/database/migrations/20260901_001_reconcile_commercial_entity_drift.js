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

const hasColumn = async (sequelize, dialect, table, column) => {
    if (dialect === 'postgres') {
        const [rows] = await sequelize.query(`
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = '${table}'
               AND column_name = '${column}'
             LIMIT 1
        `);
        return rows.length > 0;
    }

    const [rows] = await sequelize.query(`PRAGMA table_info(${table});`);
    return rows.some((row) => row.name === column);
};

module.exports = {
    name: '20260901_001_reconcile_commercial_entity_drift',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';
        const postgres = dialect === 'postgres';
        const metadataType = postgres ? "JSONB DEFAULT '{}'::jsonb" : "TEXT DEFAULT '{}'";
        const usageResetType = postgres ? 'TIMESTAMPTZ' : 'DATETIME';

        // Capture the source before adding the renamed target. A fresh database
        // created from the current entities has no threshold_conversations column.
        const hasLegacyThreshold = await hasColumn(
            sequelize,
            dialect,
            'subscriptions',
            'threshold_conversations',
        );

        if (postgres) {
            await sequelize.query(
                `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS metadata ${metadataType}`,
            );
            await sequelize.query(
                'ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS threshold_debt INTEGER NOT NULL DEFAULT 0',
            );
            await sequelize.query(
                `ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS usage_reset_at ${usageResetType}`,
            );
        } else {
            if (!(await hasColumn(sequelize, dialect, 'orders', 'metadata'))) {
                await sequelize.query(`ALTER TABLE orders ADD COLUMN metadata ${metadataType}`);
            }
            if (!(await hasColumn(sequelize, dialect, 'subscriptions', 'threshold_debt'))) {
                await sequelize.query(
                    'ALTER TABLE subscriptions ADD COLUMN threshold_debt INTEGER NOT NULL DEFAULT 0',
                );
            }
            if (!(await hasColumn(sequelize, dialect, 'subscriptions', 'usage_reset_at'))) {
                await sequelize.query(
                    `ALTER TABLE subscriptions ADD COLUMN usage_reset_at ${usageResetType}`,
                );
            }
        }

        if (hasLegacyThreshold) {
            // Only fill the newly-added/defaulted target. Re-applying the
            // migration must not overwrite a later operator/application value.
            await sequelize.query(`
                UPDATE public.subscriptions
                   SET threshold_debt = threshold_conversations
                 WHERE threshold_debt = 0
                   AND threshold_conversations IS NOT NULL
                   AND threshold_conversations <> 0
            `);
        }
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
