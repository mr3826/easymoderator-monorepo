'use strict';

/**
 * Migration: 20260522_007_fix_schema_drift_meta_recon
 *
 * Domain: Meta (Comment-to-DM), Reconciliation, Policy
 *
 * Entities covered:
 *   - CommentToDmEvent       → squash has dm_invite_sent_at/dm_opened_at/
 *                              dm_conversation_id/expires_at; entity uses
 *                              parent_comment_id, commenter_external_id,
 *                              commenter_name, matched_keyword,
 *                              last_transition_at, last_error
 *   - CourierCodCollection   → squash has tracking_id/order_id/expected_amount/
 *                              received_amount/status/remittance_date/notes;
 *                              entity uses payment_reference/claimed_amount/
 *                              consignment_count/consignment_ids/payment_date/raw_payload
 *   - ReconciliationDispute  → squash has cod_id/dispute_type/amount_diff/
 *                              description/status/resolution_note;
 *                              entity uses collection_id/provider/payment_reference/
 *                              claimed_amount/expected_amount/discrepancy_amount/
 *                              dispute_status/notes
 *   - PolicyDecision         → squash has action/decision/reason/metadata;
 *                              entity has conversation_id/direction/allow/rule_results/
 *                              transform_applied/augment/policy_version/message_hash
 */

module.exports = {
    name: '20260522_007_fix_schema_drift_meta_recon',

    up: async (sequelize) => {

        // ── 1. comment_to_dm_events ───────────────────────────────────────────────
        // Entity columns missing from squash:
        //   parent_comment_id, commenter_external_id, commenter_name,
        //   matched_keyword, last_transition_at, last_error
        // Squash has: dm_invite_sent_at, dm_opened_at, dm_conversation_id, expires_at
        //   (those stay — backward compat)
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS parent_comment_id VARCHAR(64);`);
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS commenter_external_id VARCHAR(64);`);
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS commenter_name VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS matched_keyword VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS last_transition_at TIMESTAMPTZ DEFAULT NOW();`);
        await sequelize.query(`ALTER TABLE comment_to_dm_events ADD COLUMN IF NOT EXISTS last_error TEXT;`);
        // Backfill last_transition_at to match created_at for existing rows
        await sequelize.query(`UPDATE comment_to_dm_events SET last_transition_at = created_at WHERE last_transition_at IS NULL;`);
        // Entity indexes
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_shop_state ON comment_to_dm_events(shop_id, state);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_state_transition ON comment_to_dm_events(state, last_transition_at);`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ctdm_channel_post ON comment_to_dm_events(channel_id, post_id);`);

        // ── 2. courier_cod_collections ────────────────────────────────────────────
        // Entity columns: payment_reference, claimed_amount, consignment_count,
        //   consignment_ids, payment_date, raw_payload
        // Squash columns: tracking_id, order_id, expected_amount, received_amount,
        //   status, remittance_date, notes
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS claimed_amount DECIMAL(12,2);`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS consignment_count INTEGER NOT NULL DEFAULT 0;`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS consignment_ids TEXT DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS payment_date DATE;`);
        await sequelize.query(`ALTER TABLE courier_cod_collections ADD COLUMN IF NOT EXISTS raw_payload TEXT;`);
        // Backfill claimed_amount from expected_amount for existing rows
        await sequelize.query(`UPDATE courier_cod_collections SET claimed_amount = expected_amount WHERE claimed_amount IS NULL AND expected_amount IS NOT NULL;`);
        // Backfill payment_reference from tracking_id for existing rows
        await sequelize.query(`UPDATE courier_cod_collections SET payment_reference = tracking_id WHERE payment_reference IS NULL AND tracking_id IS NOT NULL;`);
        // Backfill payment_date from remittance_date
        await sequelize.query(`UPDATE courier_cod_collections SET payment_date = remittance_date::DATE WHERE payment_date IS NULL AND remittance_date IS NOT NULL;`);

        // ── 3. reconciliation_disputes ────────────────────────────────────────────
        // Entity columns: collection_id (vs squash 'cod_id'), provider,
        //   payment_reference, claimed_amount, expected_amount, discrepancy_amount,
        //   dispute_status (vs squash 'status'), notes (vs squash 'description')
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES courier_cod_collections(id) ON DELETE CASCADE;`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS provider VARCHAR(100);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS claimed_amount DECIMAL(12,2);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS expected_amount DECIMAL(12,2);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS discrepancy_amount DECIMAL(12,2);`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS dispute_status VARCHAR(50) DEFAULT 'open';`);
        await sequelize.query(`ALTER TABLE reconciliation_disputes ADD COLUMN IF NOT EXISTS notes TEXT;`);
        // Backfill collection_id from cod_id (same semantic, different name)
        await sequelize.query(`UPDATE reconciliation_disputes SET collection_id = cod_id WHERE collection_id IS NULL AND cod_id IS NOT NULL;`);
        // Backfill dispute_status from status
        await sequelize.query(`UPDATE reconciliation_disputes SET dispute_status = status WHERE dispute_status = 'open' AND status IS NOT NULL AND status <> 'open';`);
        // Backfill notes from description
        await sequelize.query(`UPDATE reconciliation_disputes SET notes = description WHERE notes IS NULL AND description IS NOT NULL;`);
        // Backfill discrepancy_amount from amount_diff
        await sequelize.query(`UPDATE reconciliation_disputes SET discrepancy_amount = amount_diff WHERE discrepancy_amount IS NULL AND amount_diff IS NOT NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_rd_collection ON reconciliation_disputes(collection_id) WHERE collection_id IS NOT NULL;`);

        // ── 4. policy_decisions ───────────────────────────────────────────────────
        // Squash: action VARCHAR(50), decision VARCHAR(20), reason VARCHAR(100), metadata JSONB
        // Entity: conversation_id UUID, direction VARCHAR(16), allow BOOLEAN,
        //         rule_results JSONB, transform_applied BOOLEAN, augment JSONB,
        //         policy_version VARCHAR(32), message_hash VARCHAR(64)
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS conversation_id UUID;`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS direction VARCHAR(16) DEFAULT 'outbound';`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS allow BOOLEAN;`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS rule_results JSONB DEFAULT '[]';`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS transform_applied BOOLEAN NOT NULL DEFAULT FALSE;`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS augment JSONB DEFAULT '{}';`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS policy_version VARCHAR(32);`);
        await sequelize.query(`ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS message_hash VARCHAR(64);`);
        // Backfill allow from decision: 'allow' => TRUE, anything else => FALSE
        await sequelize.query(`UPDATE policy_decisions SET allow = (decision = 'allow') WHERE allow IS NULL AND decision IS NOT NULL;`);
        // Backfill policy_version default for existing rows (unknown version)
        await sequelize.query(`UPDATE policy_decisions SET policy_version = 'unknown' WHERE policy_version IS NULL;`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pd_reason ON policy_decisions(reason);`);

        console.log('[migration] 20260522_007_fix_schema_drift_meta_recon: UP complete');
    },

    down: async (sequelize) => {
        // policy_decisions
        await sequelize.query(`DROP INDEX IF EXISTS idx_pd_reason;`);
        const pdCols = ['message_hash','policy_version','augment','transform_applied',
                        'rule_results','allow','direction','conversation_id'];
        for (const col of pdCols) {
            await sequelize.query(`ALTER TABLE policy_decisions DROP COLUMN IF EXISTS ${col};`);
        }

        // reconciliation_disputes
        await sequelize.query(`DROP INDEX IF EXISTS idx_rd_collection;`);
        const rdCols = ['notes','dispute_status','discrepancy_amount','expected_amount',
                        'claimed_amount','payment_reference','provider','collection_id'];
        for (const col of rdCols) {
            await sequelize.query(`ALTER TABLE reconciliation_disputes DROP COLUMN IF EXISTS ${col};`);
        }

        // courier_cod_collections
        const cccCols = ['raw_payload','payment_date','consignment_ids','consignment_count',
                         'claimed_amount','payment_reference'];
        for (const col of cccCols) {
            await sequelize.query(`ALTER TABLE courier_cod_collections DROP COLUMN IF EXISTS ${col};`);
        }

        // comment_to_dm_events
        await sequelize.query(`DROP INDEX IF EXISTS idx_ctdm_channel_post;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_ctdm_state_transition;`);
        await sequelize.query(`DROP INDEX IF EXISTS idx_ctdm_shop_state;`);
        const ctdmCols = ['last_error','last_transition_at','matched_keyword',
                          'commenter_name','commenter_external_id','parent_comment_id'];
        for (const col of ctdmCols) {
            await sequelize.query(`ALTER TABLE comment_to_dm_events DROP COLUMN IF EXISTS ${col};`);
        }

        console.log('[migration] 20260522_007_fix_schema_drift_meta_recon: DOWN complete');
    }
};
