'use strict';

/**
 * Migration: 20260522_004_fix_schema_drift_orders_delivery
 *
 * Domain: Orders, Delivery, RTO
 *
 * Entities covered:
 *   - Order            → entity columns differ from squash (channel, items,
 *                        order_status vs status, fulfillment_status, subtotal,
 *                        tax, delivery_fee, delivery_location, delivery_provider,
 *                        delivery_consignment_id, delivery_tracking_code,
 *                        delivery_status, delivery_dispatched_at, total,
 *                        payment_method_id, paid_at, note)
 *   - OrderItem        → entity uses 'price'/'total'; squash has
 *                        'unit_price'/'total_price'
 *   - OrderReturn      → entity status is ENUM; squash uses VARCHAR
 *   - OrderSession     → completely different column set from squash
 *   - CustomerDeliveryStats → entity columns differ completely from squash
 *   - DeliveryIntegration  → missing is_connected, metadata, last_validated_at
 *   - RtoBlacklist     → missing risk_score, is_global, added_by, notes, updated_at
 *
 * Strategy: ADD COLUMN IF NOT EXISTS for all missing entity columns.
 *   Column name mismatches: add the entity's column name and backfill from
 *   the squash column where possible. Leave squash columns intact.
 */

module.exports = {
    name: '20260522_004_fix_schema_drift_orders_delivery',

    up: async (sequelize) => {

        // ── 1. orders ────────────────────────────────────────────────────────────
        // Entity columns missing from squash:
        //   channel, items, order_status (vs squash 'status'), fulfillment_status,
        //   subtotal, tax, delivery_fee, delivery_location, delivery_provider,
        //   delivery_consignment_id, delivery_tracking_code, delivery_status,
        //   delivery_dispatched_at, total (vs squash 'total_amount'), paid_at,
        //   note (vs squash 'notes'), payment_method_id
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'manual';`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_status VARCHAR(50) DEFAULT 'draft';`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(50) DEFAULT 'unfulfilled';`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax DECIMAL(10,2) DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10,2) DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_location TEXT;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_provider VARCHAR(100);`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_consignment_id VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_tracking_code VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_dispatched_at TIMESTAMPTZ;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_configs(id) ON DELETE SET NULL;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`);
        await sequelize.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT;`);

        // Backfill order_status from 'status' for existing rows
        await sequelize.query(`UPDATE orders SET order_status = status WHERE order_status = 'draft' AND status IS NOT NULL;`);
        // Backfill total from total_amount for existing rows
        await sequelize.query(`UPDATE orders SET total = total_amount WHERE total = 0 AND total_amount > 0;`);
        // Backfill note from notes for existing rows
        await sequelize.query(`UPDATE orders SET note = notes WHERE note IS NULL AND notes IS NOT NULL;`);
        // Backfill delivery_provider from courier_provider
        await sequelize.query(`UPDATE orders SET delivery_provider = courier_provider WHERE delivery_provider IS NULL AND courier_provider IS NOT NULL;`);
        // Backfill delivery_tracking_code from tracking_id
        await sequelize.query(`UPDATE orders SET delivery_tracking_code = tracking_id WHERE delivery_tracking_code IS NULL AND tracking_id IS NOT NULL;`);
        // Backfill delivery_status from courier_status
        await sequelize.query(`UPDATE orders SET delivery_status = courier_status WHERE delivery_status IS NULL AND courier_status IS NOT NULL;`);
        // Backfill delivery_fee from delivery_charge
        await sequelize.query(`UPDATE orders SET delivery_fee = delivery_charge WHERE delivery_fee = 0 AND delivery_charge > 0;`);
        // Backfill subtotal from total_amount - delivery_charge for existing rows
        await sequelize.query(`UPDATE orders SET subtotal = total_amount - COALESCE(delivery_charge, 0) WHERE subtotal = 0 AND total_amount > 0;`);

        // Entity declares unique on order_number
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(shop_id, order_status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(shop_id, created_at);`);

        // ── 2. order_items ───────────────────────────────────────────────────────
        // Entity uses 'price' and 'total'; squash has 'unit_price' and 'total_price'.
        await sequelize.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total DECIMAL(10,2) DEFAULT 0;`);
        // Backfill from squash columns
        await sequelize.query(`UPDATE order_items SET price = unit_price WHERE price = 0 AND unit_price > 0;`);
        await sequelize.query(`UPDATE order_items SET total = total_price WHERE total = 0 AND total_price > 0;`);

        // ── 3. order_returns ─────────────────────────────────────────────────────
        // Entity status is ENUM('pending_approval','approved','rejected').
        // Squash has VARCHAR(50) DEFAULT 'pending_approval'. No column missing —
        // just the ENUM type. Sequelize will auto-create it on model sync.
        // Nothing structural to add here.

        // ── 4. order_sessions ────────────────────────────────────────────────────
        // Entity columns: customer_channel_id, channel, current_step, step_data,
        //   product_info, status ENUM, automation_mode ENUM, confidence_threshold,
        //   last_activity_at, created_order_id, final_summary
        // Squash columns: conversation_id, session_data, step, is_active, expires_at,
        //   completed_at, order_id
        // Add entity columns; keep squash columns.
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS customer_channel_id VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'messenger';`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS current_step VARCHAR(50) DEFAULT 'INITIAL';`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS step_data JSONB DEFAULT '{}';`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS product_info JSONB;`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS automation_mode VARCHAR(20) DEFAULT 'DRAFT';`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS confidence_threshold INTEGER DEFAULT 60;`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS created_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;`);
        await sequelize.query(`ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS final_summary TEXT;`);
        // Backfill step from squash 'step' column
        await sequelize.query(`UPDATE order_sessions SET current_step = step WHERE current_step = 'INITIAL' AND step IS NOT NULL;`);
        // Backfill step_data from session_data
        await sequelize.query(`UPDATE order_sessions SET step_data = session_data WHERE (step_data = '{}' OR step_data IS NULL) AND session_data IS NOT NULL;`);
        // Backfill created_order_id from order_id
        await sequelize.query(`UPDATE order_sessions SET created_order_id = order_id WHERE created_order_id IS NULL AND order_id IS NOT NULL;`);
        // Backfill status from is_active
        await sequelize.query(`UPDATE order_sessions SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'ABANDONED' END WHERE status = 'ACTIVE' AND is_active IS NOT NULL;`);
        // Indexes entity declares
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_customer_channel ON order_sessions(customer_channel_id, shop_id) WHERE customer_channel_id IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_status ON order_sessions(status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_current_step ON order_sessions(current_step);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_last_activity ON order_sessions(last_activity_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_os_expires ON order_sessions(expires_at);`);

        // ── 5. customer_delivery_stats ───────────────────────────────────────────
        // Entity columns: phone, delivery_attempts, rto_count, last_rto_at,
        //   last_delivered_at (no customer_id FK — uses phone as key)
        // Squash columns: customer_id UNIQUE, total_orders, delivered_orders,
        //   refused_orders, rto_orders, delivery_success_rate, last_updated
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS rto_count INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS last_rto_at TIMESTAMPTZ;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;`);
        // Backfill delivery_attempts from total_orders
        await sequelize.query(`UPDATE customer_delivery_stats SET delivery_attempts = total_orders WHERE delivery_attempts = 0 AND total_orders > 0;`);
        // Backfill rto_count from rto_orders
        await sequelize.query(`UPDATE customer_delivery_stats SET rto_count = rto_orders WHERE rto_count = 0 AND rto_orders > 0;`);

        // ── 6. delivery_integrations ─────────────────────────────────────────────
        // Entity: is_connected BOOLEAN, metadata JSON, last_validated_at
        // Squash: is_active, credentials, config, last_tested_at
        await sequelize.query(`ALTER TABLE delivery_integrations ADD COLUMN IF NOT EXISTS is_connected BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE delivery_integrations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';`);
        await sequelize.query(`ALTER TABLE delivery_integrations ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ;`);
        // Backfill is_connected from is_active
        await sequelize.query(`UPDATE delivery_integrations SET is_connected = is_active WHERE is_connected = FALSE AND is_active = TRUE;`);
        // Backfill last_validated_at from last_tested_at
        await sequelize.query(`UPDATE delivery_integrations SET last_validated_at = last_tested_at WHERE last_validated_at IS NULL AND last_tested_at IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_di_provider ON delivery_integrations(provider);`);

        // ── 7. rto_blacklist ─────────────────────────────────────────────────────
        // Entity: risk_score INTEGER, is_global BOOLEAN, added_by UUID, notes TEXT, updated_at
        // Squash: phone, reason, created_at, UNIQUE(shop_id, phone)
        await sequelize.query(`ALTER TABLE rto_blacklist ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 80;`);
        await sequelize.query(`ALTER TABLE rto_blacklist ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE rto_blacklist ADD COLUMN IF NOT EXISTS added_by UUID;`);
        await sequelize.query(`ALTER TABLE rto_blacklist ADD COLUMN IF NOT EXISTS notes TEXT;`);
        await sequelize.query(`ALTER TABLE rto_blacklist ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
        // The squash UNIQUE(shop_id, phone) conflicts with is_global=true (shop_id NULL).
        // Entity has shop_id nullable. The squash constraint will reject NULL shop_id.
        // We leave the constraint in place (product review item) and note it.

        console.log('[migration] 20260522_004_fix_schema_drift_orders_delivery: UP complete');
    },

    down: async (sequelize) => {
        // rto_blacklist
        await sequelize.query(`ALTER TABLE rto_blacklist DROP COLUMN IF EXISTS updated_at;`);
        await sequelize.query(`ALTER TABLE rto_blacklist DROP COLUMN IF EXISTS notes;`);
        await sequelize.query(`ALTER TABLE rto_blacklist DROP COLUMN IF EXISTS added_by;`);
        await sequelize.query(`ALTER TABLE rto_blacklist DROP COLUMN IF EXISTS is_global;`);
        await sequelize.query(`ALTER TABLE rto_blacklist DROP COLUMN IF EXISTS risk_score;`);

        // delivery_integrations
        await sequelize.query(`DROP INDEX IF EXISTS idx_di_provider;`);
        await sequelize.query(`ALTER TABLE delivery_integrations DROP COLUMN IF EXISTS last_validated_at;`);
        await sequelize.query(`ALTER TABLE delivery_integrations DROP COLUMN IF EXISTS metadata;`);
        await sequelize.query(`ALTER TABLE delivery_integrations DROP COLUMN IF EXISTS is_connected;`);

        // customer_delivery_stats
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS last_delivered_at;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS last_rto_at;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS rto_count;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS delivery_attempts;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS phone;`);

        // order_sessions
        await sequelize.query(`DROP INDEX IF EXISTS idx_os_expires;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_os_last_activity;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_os_current_step;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_os_status;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_os_customer_channel;`);
        const osCols = ['final_summary','created_order_id','last_activity_at',
                        'confidence_threshold','automation_mode','status',
                        'product_info','step_data','current_step','channel','customer_channel_id'];
        for (const col of osCols) {
            await sequelize.query(`ALTER TABLE order_sessions DROP COLUMN IF EXISTS ${col};`);
        }

        // order_items
        await sequelize.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS total;`);
        await sequelize.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS price;`);

        // orders
        await sequelize.query(`DROP INDEX IF EXISTS idx_orders_created;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_orders_order_status;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_orders_order_number;`);
        const orderCols = ['note','paid_at','payment_method_id','total',
                           'delivery_dispatched_at','delivery_status','delivery_tracking_code',
                           'delivery_consignment_id','delivery_provider','delivery_location',
                           'delivery_fee','tax','subtotal','fulfillment_status',
                           'order_status','items','channel'];
        for (const col of orderCols) {
            await sequelize.query(`ALTER TABLE orders DROP COLUMN IF EXISTS ${col};`);
        }

        console.log('[migration] 20260522_004_fix_schema_drift_orders_delivery: DOWN complete');
    }
};
