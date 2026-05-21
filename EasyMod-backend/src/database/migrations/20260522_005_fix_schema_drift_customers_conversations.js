'use strict';

/**
 * Migration: 20260522_005_fix_schema_drift_customers_conversations
 *
 * Domain: Customers, Conversations, Messages, Notifications
 *
 * Entities covered:
 *   - CustomerPreference → squash has only 'preferences' JSONB; entity has
 *                          preferred_payment, preferred_size, delivery_zone,
 *                          total_orders, total_spent, last_ordered_at, notes.
 *   - Conversation       → entity adds title, role, message, intent, confidence,
 *                          llm_used, cache_hit, keyword_match, hitl, assignee_id.
 *                          Squash has hitl_active, hitl_reason, hitl_started_at,
 *                          hitl_ended_at, resolved_by instead.
 *   - Message            → entity adds ai_suggestion, ai_confidence.
 *                          Entity sender is ENUM but squash is VARCHAR (no crash for
 *                          reads; INSERT of valid values works fine).
 *   - PushSubscription   → squash has 'subscription' JSONB; entity uses
 *                          'type' ENUM, 'subscription_json' JSONB, 'device_token'.
 */

module.exports = {
    name: '20260522_005_fix_schema_drift_customers_conversations',

    up: async (sequelize) => {

        // ── 1. customer_preferences ──────────────────────────────────────────────
        // Squash: preferences JSONB, customer_id UNIQUE, shop_id
        // Entity: preferred_payment, preferred_size, delivery_zone, total_orders,
        //         total_spent, last_ordered_at, notes
        // The squash unique constraint is on customer_id alone; entity has
        // composite unique on (shop_id, customer_id). Both can coexist.
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS preferred_payment VARCHAR(20);`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS preferred_size VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS total_spent DECIMAL(12,2) NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS last_ordered_at TIMESTAMPTZ;`);
        await sequelize.query(`ALTER TABLE customer_preferences ADD COLUMN IF NOT EXISTS notes TEXT;`);
        // Entity declares composite unique index (shop_id, customer_id)
        await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_custpref_shop_customer ON customer_preferences(shop_id, customer_id);`);

        // ── 2. conversations ─────────────────────────────────────────────────────
        // Entity columns missing from squash:
        //   title, role (ENUM), message, intent, confidence, llm_used,
        //   cache_hit, keyword_match, hitl, assignee_id
        // channel in squash is VARCHAR(50); entity has VARCHAR(20) — type diff only
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS role VARCHAR(20);`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message TEXT;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS intent VARCHAR(50);`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS confidence INTEGER;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS llm_used BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS keyword_match BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS hitl BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assignee_id UUID;`);
        // Backfill hitl from hitl_active where present
        await sequelize.query(`UPDATE conversations SET hitl = hitl_active WHERE hitl = FALSE AND hitl_active = TRUE;`);
        // Channel NOT NULL constraint: squash allows nullable, entity requires it.
        // No ALTER here — entity has allowNull: false but we cannot add NOT NULL
        // to an existing column without a default. Leave as-is; new inserts
        // will always provide channel.

        // Entity indexes
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_shop_channel_status ON conversations(shop_id, channel, status);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_convs_shop_customer_channel ON conversations(shop_id, customer_id, channel, created_at);`);

        // ── 3. messages ──────────────────────────────────────────────────────────
        // Entity adds ai_suggestion, ai_confidence
        await sequelize.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_suggestion TEXT;`);
        await sequelize.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);`);
        // Entity has 'content' NOT NULL which squash already has with DEFAULT ''.
        // Entity has 'customer_id' — squash already has it.
        // Entity updatedAt: false — squash already has no updated_at.

        // ── 4. push_subscriptions ────────────────────────────────────────────────
        // Squash: subscription JSONB
        // Entity: type ENUM('web','fcm'), subscription_json JSONB, device_token TEXT
        await sequelize.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS type VARCHAR(10);`);
        await sequelize.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS subscription_json JSONB;`);
        await sequelize.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS device_token TEXT;`);
        // Backfill subscription_json from subscription
        await sequelize.query(`UPDATE push_subscriptions SET subscription_json = subscription WHERE subscription_json IS NULL AND subscription IS NOT NULL;`);
        // Default type for existing rows (web push was the only type before FCM)
        await sequelize.query(`UPDATE push_subscriptions SET type = 'web' WHERE type IS NULL AND subscription IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_type ON push_subscriptions(type);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_push_shop_type ON push_subscriptions(shop_id, type);`);

        console.log('[migration] 20260522_005_fix_schema_drift_customers_conversations: UP complete');
    },

    down: async (sequelize) => {
        // push_subscriptions
        await sequelize.query(`DROP INDEX IF EXISTS idx_push_shop_type;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_push_type;`);
        await sequelize.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS device_token;`);
        await sequelize.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS subscription_json;`);
        await sequelize.query(`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS type;`);

        // messages
        await sequelize.query(`ALTER TABLE messages DROP COLUMN IF EXISTS ai_confidence;`);
        await sequelize.query(`ALTER TABLE messages DROP COLUMN IF EXISTS ai_suggestion;`);

        // conversations
        await sequelize.query(`DROP INDEX IF EXISTS idx_convs_shop_customer_channel;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_convs_shop_channel_status;`);
        const convCols = ['assignee_id','hitl','keyword_match','cache_hit','llm_used',
                          'confidence','intent','message','role','title'];
        for (const col of convCols) {
            await sequelize.query(`ALTER TABLE conversations DROP COLUMN IF EXISTS ${col};`);
        }

        // customer_preferences
        await sequelize.query(`DROP INDEX IF EXISTS idx_custpref_shop_customer;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS notes;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS last_ordered_at;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS total_spent;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS total_orders;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS delivery_zone;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS preferred_size;`);
        await sequelize.query(`ALTER TABLE customer_preferences DROP COLUMN IF EXISTS preferred_payment;`);

        console.log('[migration] 20260522_005_fix_schema_drift_customers_conversations: DOWN complete');
    }
};
