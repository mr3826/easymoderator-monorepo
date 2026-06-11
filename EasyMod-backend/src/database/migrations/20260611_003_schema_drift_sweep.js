/**
 * Schema-drift sweep: align every prod table with what the entities/services
 * actually read and write.
 *
 * Found by scripts/schema-drift-audit.js after the fourth incident of the same
 * family (order_sessions.metadata, orders.idempotency_key, delivery
 * credentials JSONB, order_sequences.counter). All affected tables had ZERO
 * rows in prod — these code paths have never once succeeded there — so every
 * change below is data-risk-free. Each block is guarded/idempotent because the
 * runner does not wrap migrations in a transaction: a partial failure must be
 * safely re-runnable.
 *
 *  1. order_sequences.counter            → next_number   (every order INSERT
 *     died: "column next_number does not exist" — manual AND chatbot orders)
 *  2. policy_decisions.action/decision   → dropped       (legacy NOT NULL cols
 *     the entity never writes — every policy audit INSERT failed)
 *  3. subscriptions status enum          + trialing, trial_expired, past_due
 *     (entity default is 'trialing' — new signups would crash on the enum)
 *  4. topup_transactions                 → recreated     (squash dropped it;
 *     top-up purchase INSERT had no table)
 *  5. conversation_usage                 → recreated     (squash dropped it;
 *     fair-use conversation counting failed silently on every message)
 *  6. push_subscriptions.subscription    → dropped       (legacy NOT NULL col)
 *  7. customer_delivery_stats.customer_id→ dropped       (legacy NOT NULL col;
 *     rto-shield findOrCreate keys on shop_id+phone)
 *  8. courier_cod_collections.tracking_id/expected_amount → dropped (legacy)
 *  9. reconciliation_disputes            + resolved_by, − dispute_type
 * 10. trx_id_logs.gateway                → dropped; amount NOT NULL relaxed
 *     (entity allows null amount when OCR can't extract it)
 * 11. invoices.id                        text → uuid
 * 12. usage_events id/request_id/resource_id text → uuid;
 *     resource_metadata text → jsonb
 */

module.exports = {
    name: '20260611_003_schema_drift_sweep',

    up: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return; // prod-drift repair only

        // 1. order_sequences: counter → next_number
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'order_sequences' AND column_name = 'counter')
                   AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'order_sequences' AND column_name = 'next_number') THEN
                    ALTER TABLE order_sequences RENAME COLUMN counter TO next_number;
                    ALTER TABLE order_sequences ALTER COLUMN next_number SET DEFAULT 1;
                END IF;
            END $$;
        `);

        // 2. policy_decisions: drop legacy NOT NULL columns the entity never writes
        await sequelize.query(`ALTER TABLE policy_decisions DROP COLUMN IF EXISTS action;`);
        await sequelize.query(`ALTER TABLE policy_decisions DROP COLUMN IF EXISTS decision;`);

        // 3. subscriptions status enum: values the entity uses (default 'trialing'!)
        // ADD VALUE IF NOT EXISTS is idempotent; allowed in PG >= 12 even mid-txn.
        await sequelize.query(`ALTER TYPE enum_subscriptions_status ADD VALUE IF NOT EXISTS 'trialing';`);
        await sequelize.query(`ALTER TYPE enum_subscriptions_status ADD VALUE IF NOT EXISTS 'trial_expired';`);
        await sequelize.query(`ALTER TYPE enum_subscriptions_status ADD VALUE IF NOT EXISTS 'past_due';`);

        // 4. topup_transactions (shape from archived 20260510_002; matches
        //    topup.service.js inserts/updates)
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS topup_transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id UUID NOT NULL,
                pack_code TEXT NOT NULL,
                pack_conversations INTEGER NOT NULL,
                amount_bdt DECIMAL(10,2) NOT NULL,
                bkash_payment_id TEXT,
                bkash_trx_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                invoice_number TEXT,
                invoice_pdf_url TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMPTZ,
                CONSTRAINT fk_topup_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_topup_shop_status ON topup_transactions(shop_id, status);`);

        // 5. conversation_usage (fair-use counter; the unique index is REQUIRED —
        //    recordConversation() upserts ON CONFLICT (shop_id, conversation_id, billing_period))
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS conversation_usage (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                shop_id UUID NOT NULL,
                conversation_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'package',
                counted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                billing_period TEXT NOT NULL,
                CONSTRAINT fk_conv_usage_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            );
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_conv_usage_shop_period ON conversation_usage(shop_id, billing_period);`);
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_usage_unique ON conversation_usage(shop_id, conversation_id, billing_period);`);

        // 6. push_subscriptions: legacy jsonb column (entity uses type/subscription_json/device_token)
        await sequelize.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS subscription;`);

        // 7. customer_delivery_stats: legacy customer_id (drops its FK + unique with it)
        await sequelize.query(`ALTER TABLE customer_delivery_stats DROP COLUMN IF EXISTS customer_id;`);

        // 8. courier_cod_collections: legacy columns from the pre-rework shape
        await sequelize.query(`ALTER TABLE courier_cod_collections DROP COLUMN IF EXISTS tracking_id;`);
        await sequelize.query(`ALTER TABLE courier_cod_collections DROP COLUMN IF EXISTS expected_amount;`);

        // 9. reconciliation_disputes: entity reads resolved_by; dispute_type is legacy
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS resolved_by UUID;`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes DROP COLUMN IF EXISTS dispute_type;`);

        // 10. trx_id_logs: gateway is legacy; amount may be null when OCR fails
        await sequelize.query(`ALTER TABLE trx_id_logs DROP COLUMN IF EXISTS gateway;`);
        await sequelize.query(`ALTER TABLE trx_id_logs ALTER COLUMN amount DROP NOT NULL;`);

        // 11. invoices.id: text → uuid (entity is UUID; table empty)
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'invoices' AND column_name = 'id' AND data_type = 'text') THEN
                    ALTER TABLE invoices ALTER COLUMN id TYPE UUID USING id::uuid;
                END IF;
            END $$;
        `);

        // 12. usage_events: uuid ids + jsonb metadata (entity types; table empty)
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'usage_events' AND column_name = 'id' AND data_type = 'text') THEN
                    ALTER TABLE usage_events ALTER COLUMN id TYPE UUID USING id::uuid;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'usage_events' AND column_name = 'request_id' AND data_type = 'text') THEN
                    ALTER TABLE usage_events ALTER COLUMN request_id TYPE UUID USING request_id::uuid;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'usage_events' AND column_name = 'resource_id' AND data_type = 'text') THEN
                    ALTER TABLE usage_events ALTER COLUMN resource_id TYPE UUID USING resource_id::uuid;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'usage_events' AND column_name = 'resource_metadata' AND data_type = 'text') THEN
                    ALTER TABLE usage_events ALTER COLUMN resource_metadata TYPE JSONB
                        USING CASE WHEN resource_metadata IS NULL OR resource_metadata = ''
                                   THEN NULL ELSE resource_metadata::jsonb END;
                END IF;
            END $$;
        `);
    },

    down: async (sequelize) => {
        if (sequelize.getDialect() !== 'postgres') return;

        // Enum values cannot be removed in PostgreSQL — trialing/trial_expired/
        // past_due stay (harmless). Legacy columns are restored NULLABLE only:
        // their original NOT NULLs are what broke every insert in the first place.
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'order_sequences' AND column_name = 'next_number') THEN
                    ALTER TABLE order_sequences RENAME COLUMN next_number TO counter;
                    ALTER TABLE order_sequences ALTER COLUMN counter SET DEFAULT 0;
                END IF;
            END $$;
        `);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS action VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS decision VARCHAR(20);`);
        await sequelize.query(`DROP TABLE IF EXISTS topup_transactions;`);
        await sequelize.query(`DROP TABLE IF EXISTS conversation_usage;`);
        await sequelize.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS subscription JSONB;`);
        await sequelize.query(`ALTER TABLE customer_delivery_stats ADD COLUMN IF NOT EXISTS customer_id UUID;`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(12,2);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes DROP COLUMN IF EXISTS resolved_by;`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS dispute_type VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE trx_id_logs ADD COLUMN IF NOT EXISTS gateway VARCHAR(50);`);
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'invoices' AND column_name = 'id' AND data_type = 'uuid') THEN
                    ALTER TABLE invoices ALTER COLUMN id TYPE TEXT USING id::text;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'usage_events' AND column_name = 'id' AND data_type = 'uuid') THEN
                    ALTER TABLE usage_events ALTER COLUMN id TYPE TEXT USING id::text;
                    ALTER TABLE usage_events ALTER COLUMN request_id TYPE TEXT USING request_id::text;
                    ALTER TABLE usage_events ALTER COLUMN resource_id TYPE TEXT USING resource_id::text;
                    ALTER TABLE usage_events ALTER COLUMN resource_metadata TYPE TEXT USING resource_metadata::text;
                END IF;
            END $$;
        `);
    }
};
