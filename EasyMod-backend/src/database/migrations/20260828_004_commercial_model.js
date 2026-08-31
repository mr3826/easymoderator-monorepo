'use strict';

/**
 * Shuru / Growth / Partner commercial model.
 *
 * The checkout already contains a same-day 20260828_003 courier migration, so
 * this migration intentionally uses the next sequence number. It is additive
 * and safe while an older application image is still serving traffic.
 */

const optionalQuery = async (sequelize, sql) => {
    try {
        return await sequelize.query(sql);
    } catch (_) {
        // Optional compatibility DDL is allowed to be absent on a minimal schema.
        return null;
    }
};

const hasColumn = async (sequelize, table, column) => {
    const [columns] = await sequelize.query(`PRAGMA table_info(${table});`);
    return columns.some((entry) => entry.name === column);
};

module.exports = {
    name: '20260828_004_commercial_model',

    up: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';
        const postgres = dialect === 'postgres';
        // Production has a native status enum despite the historical migration
        // note saying VARCHAR. Cast before COALESCE so NULL-safe comparisons do
        // not ask PostgreSQL to parse an empty string as an enum value.
        const statusExpr = postgres
            ? "LOWER(COALESCE(status::text, ''))"
            : "LOWER(COALESCE(status, ''))";
        const orderStatusExpr = postgres
            ? "LOWER(COALESCE(order_status::text, ''))"
            : "LOWER(COALESCE(order_status, ''))";

        // New signups are Shuru. Each default ALTER is isolated so a partial
        // schema cannot prevent the rest of the forward-compatible migration.
        if (postgres) {
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN conversations_limit SET DEFAULT 100"
            );
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN plan_name SET DEFAULT 'Shuru'"
            );
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN plan_code SET DEFAULT 'SHURU'"
            );
            await optionalQuery(
                sequelize,
                'ALTER TABLE subscriptions ALTER COLUMN plan_price SET DEFAULT 0'
            );
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'active'"
            );
        }

        // Legacy trial and free states become active Shuru. Partner is excluded
        // so an approved per-order merchant is never rewritten by a status fix.
        await sequelize.query(`
            UPDATE subscriptions
               SET plan_code = 'SHURU',
                   plan_name = 'Shuru',
                   plan_price = 0,
                   conversations_limit = 100,
                   status = 'active',
                   trial_ends_at = NULL
             WHERE UPPER(COALESCE(plan_code, '')) <> 'PARTNER'
               AND ${statusExpr} IN ('trialing', 'trial_expired')
        `);

        // A Growth merchant keeps the same billing state and anchors; only the
        // included entitlement changes from 300 to 500. Suspended/past-due rows
        // must retain the paid entitlement so reactivation cannot restore the
        // retired 300-conversation cap.
        await sequelize.query(`
            UPDATE subscriptions
             SET conversations_limit = 500
             WHERE UPPER(COALESCE(plan_code, '')) = 'GROWTH'
                AND ${statusExpr} IN ('active', 'past_due', 'suspended')
        `);

        // Cancelled/inactive merchants owe nothing and can use free Shuru again.
        // Suspended rows are deliberately untouched because dunning owns their debt.
        await sequelize.query(`
            UPDATE subscriptions
               SET plan_code = 'SHURU',
                   plan_name = 'Shuru',
                   plan_price = 0,
                   conversations_limit = 100,
                   status = 'active',
                   trial_ends_at = NULL
             WHERE UPPER(COALESCE(plan_code, '')) <> 'PARTNER'
               AND ${statusExpr} IN ('cancelled', 'inactive')
        `);

        // Any other non-partner active/unknown legacy code fails closed to the
        // free entitlement. Suspended rows remain under the existing dunning
        // state and are intentionally not revived by this migration.
        await sequelize.query(`
            UPDATE subscriptions
               SET plan_code = 'SHURU',
                   plan_name = 'Shuru',
                   plan_price = 0,
                   conversations_limit = 100,
                   status = 'active',
                   trial_ends_at = NULL
             WHERE UPPER(COALESCE(plan_code, '')) NOT IN ('GROWTH', 'PARTNER', 'SHURU')
               AND ${statusExpr} <> 'suspended'
        `);

        // Orders need an immutable delivery timestamp for both eligibility and
        // month-end invoice recomputation. Old code ignores the new column.
        if (postgres) {
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL');
            await sequelize.query('CREATE INDEX IF NOT EXISTS idx_orders_shop_delivered_at ON orders (shop_id, delivered_at)');
            await sequelize.query(`
                UPDATE orders
                   SET delivered_at = updated_at
                 WHERE ${orderStatusExpr} = 'delivered'
                   AND delivered_at IS NULL
            `);

            // The invoice entity now persists the payment binding and Partner
            // derivation snapshot. Existing invoices remain unchanged.
            await sequelize.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_id VARCHAR(255)");
            await sequelize.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
            await sequelize.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bkash_url VARCHAR(1024)');
            await sequelize.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_lease_id VARCHAR(255)');
            await sequelize.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_lease_expires_at TIMESTAMPTZ');
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS partner_billing_adjustments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                    amount_bdt DECIMAL(10,2) NOT NULL,
                    reason VARCHAR(128) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    applied_at TIMESTAMPTZ,
                    UNIQUE (shop_id, order_id)
                )
            `);
            await sequelize.query('CREATE INDEX IF NOT EXISTS idx_partner_adjustments_pending ON partner_billing_adjustments (shop_id, status, created_at)');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_bkash_payment ON topup_transactions (bkash_payment_id) WHERE bkash_payment_id IS NOT NULL');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_bkash_trx ON topup_transactions (bkash_trx_id) WHERE bkash_trx_id IS NOT NULL');
            await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128)');
            await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN IF NOT EXISTS bkash_url VARCHAR(1024)');
            await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN IF NOT EXISTS checkout_lease_id VARCHAR(255)');
            await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN IF NOT EXISTS checkout_lease_expires_at TIMESTAMPTZ');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_shop_idempotency ON topup_transactions (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices (payment_id) WHERE payment_id IS NOT NULL');
            await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_recurring_period ON invoices (subscription_id, invoice_type, billing_period_start) WHERE invoice_type IN ('monthly_subscription', 'yearly_subscription', 'partner_per_order') AND billing_period_start IS NOT NULL");
        } else {
            if (!(await hasColumn(sequelize, 'orders', 'delivered_at'))) {
                await sequelize.query('ALTER TABLE orders ADD COLUMN delivered_at DATETIME');
            }
            await sequelize.query('CREATE INDEX IF NOT EXISTS idx_orders_shop_delivered_at ON orders (shop_id, delivered_at)');
            await sequelize.query(`
                UPDATE orders
                   SET delivered_at = updated_at
                 WHERE ${orderStatusExpr} = 'delivered'
                   AND delivered_at IS NULL
            `);
            if (!(await hasColumn(sequelize, 'invoices', 'payment_id'))) {
                await sequelize.query('ALTER TABLE invoices ADD COLUMN payment_id VARCHAR(255)');
            }
            if (!(await hasColumn(sequelize, 'invoices', 'metadata'))) {
                await sequelize.query("ALTER TABLE invoices ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
            }
            if (!(await hasColumn(sequelize, 'invoices', 'bkash_url'))) {
                await sequelize.query('ALTER TABLE invoices ADD COLUMN bkash_url VARCHAR(1024)');
            }
            if (!(await hasColumn(sequelize, 'invoices', 'checkout_lease_id'))) {
                await sequelize.query('ALTER TABLE invoices ADD COLUMN checkout_lease_id VARCHAR(255)');
            }
            if (!(await hasColumn(sequelize, 'invoices', 'checkout_lease_expires_at'))) {
                await sequelize.query('ALTER TABLE invoices ADD COLUMN checkout_lease_expires_at DATETIME');
            }
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS partner_billing_adjustments (
                    id TEXT PRIMARY KEY,
                    shop_id TEXT NOT NULL,
                    order_id TEXT NOT NULL,
                    amount_bdt DECIMAL(10,2) NOT NULL,
                    reason VARCHAR(128) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    invoice_id TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    applied_at DATETIME,
                    UNIQUE (shop_id, order_id)
                )
            `);
            await sequelize.query('CREATE INDEX IF NOT EXISTS idx_partner_adjustments_pending ON partner_billing_adjustments (shop_id, status, created_at)');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_bkash_payment ON topup_transactions (bkash_payment_id) WHERE bkash_payment_id IS NOT NULL');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_bkash_trx ON topup_transactions (bkash_trx_id) WHERE bkash_trx_id IS NOT NULL');
            if (!(await hasColumn(sequelize, 'topup_transactions', 'idempotency_key'))) {
                await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN idempotency_key VARCHAR(128)');
            }
            if (!(await hasColumn(sequelize, 'topup_transactions', 'bkash_url'))) {
                await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN bkash_url VARCHAR(1024)');
            }
            if (!(await hasColumn(sequelize, 'topup_transactions', 'checkout_lease_id'))) {
                await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN checkout_lease_id VARCHAR(255)');
            }
            if (!(await hasColumn(sequelize, 'topup_transactions', 'checkout_lease_expires_at'))) {
                await sequelize.query('ALTER TABLE topup_transactions ADD COLUMN checkout_lease_expires_at DATETIME');
            }
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_shop_idempotency ON topup_transactions (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL');
            await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices (payment_id) WHERE payment_id IS NOT NULL');
            await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_recurring_period ON invoices (subscription_id, invoice_type, billing_period_start) WHERE invoice_type IN ('monthly_subscription', 'yearly_subscription', 'partner_per_order') AND billing_period_start IS NOT NULL");
        }
    },

    down: async (sequelize) => {
        const dialect = typeof sequelize.getDialect === 'function'
            ? sequelize.getDialect()
            : 'postgres';

        if (dialect === 'postgres') {
            // Data backfill is intentionally not reversed: the old plan identity
            // and trial state are no longer recoverable from the collapsed rows.
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN plan_name SET DEFAULT 'Growth'"
            );
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN plan_code SET DEFAULT 'GROWTH'"
            );
            await optionalQuery(
                sequelize,
                'ALTER TABLE subscriptions ALTER COLUMN plan_price SET DEFAULT 999'
            );
            await optionalQuery(
                sequelize,
                'ALTER TABLE subscriptions ALTER COLUMN conversations_limit SET DEFAULT 300'
            );
            await optionalQuery(
                sequelize,
                "ALTER TABLE subscriptions ALTER COLUMN status SET DEFAULT 'trialing'"
            );
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_orders_shop_delivered_at');
            await optionalQuery(sequelize, 'ALTER TABLE orders DROP COLUMN IF EXISTS delivered_at');
            await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN IF EXISTS payment_id');
            await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN IF EXISTS bkash_url');
            await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN IF EXISTS checkout_lease_id');
            await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN IF EXISTS checkout_lease_expires_at');
            await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN IF EXISTS metadata');
            await optionalQuery(sequelize, 'DROP TABLE IF EXISTS partner_billing_adjustments');
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_shop_idempotency');
            await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN IF EXISTS idempotency_key');
            await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN IF EXISTS bkash_url');
            await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN IF EXISTS checkout_lease_id');
            await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN IF EXISTS checkout_lease_expires_at');
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_bkash_payment');
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_bkash_trx');
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_invoices_payment_id');
            await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_invoices_recurring_period');
            return;
        }

        // SQLite versions used in local development support DROP COLUMN, but
        // rollback remains best-effort for older disposable schemas.
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_orders_shop_delivered_at');
        await optionalQuery(sequelize, 'ALTER TABLE orders DROP COLUMN delivered_at');
        await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN payment_id');
        await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN bkash_url');
        await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN checkout_lease_id');
        await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN checkout_lease_expires_at');
        await optionalQuery(sequelize, 'ALTER TABLE invoices DROP COLUMN metadata');
        await optionalQuery(sequelize, 'DROP TABLE IF EXISTS partner_billing_adjustments');
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_shop_idempotency');
        await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN idempotency_key');
        await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN bkash_url');
        await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN checkout_lease_id');
        await optionalQuery(sequelize, 'ALTER TABLE topup_transactions DROP COLUMN checkout_lease_expires_at');
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_bkash_payment');
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_topup_bkash_trx');
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_invoices_payment_id');
        await optionalQuery(sequelize, 'DROP INDEX IF EXISTS idx_invoices_recurring_period');
    }
};
