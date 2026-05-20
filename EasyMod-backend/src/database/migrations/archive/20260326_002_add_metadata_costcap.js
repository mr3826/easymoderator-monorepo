// src/database/migrations/20260326_002_add_metadata_costcap.js
// TASK 3: Cost Cap Enforcement (Metadata Schema)
// Purpose: Add tracking for LLM call count per message to enforce 2-call limit
// Owner: Backend Dev
// Effort: 0.5 days
// Deadline: End of Day 2

'use strict';

module.exports = {
  name: '20260326_002_add_metadata_costcap',

  up: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    try {
      await sequelize.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'`);
    } catch (err) {
      if (!err.message.toLowerCase().includes('already exists')) throw err;
    }
    try {
      await sequelize.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_messages_cost_cap_status') THEN
            CREATE TYPE enum_messages_cost_cap_status AS ENUM ('PENDING','LLM_CALLS_1','LLM_CALLS_2','ESCALATED','RESOLVED');
          END IF;
        END $$;
      `);
      await qi.addColumn('messages', 'cost_cap_status', {
        type: 'enum_messages_cost_cap_status',
        defaultValue: 'PENDING',
        allowNull: false,
      });
    } catch (err) {
      if (!err.message.toLowerCase().includes('already exists')) throw err;
    }
    for (const [name, fields] of [['idx_msg_shop_costcap', ['shop_id', 'cost_cap_status']], ['idx_msg_shop_date', ['shop_id', 'created_at']]]) {
      try { await qi.addIndex('messages', fields, { name }); } catch (_) {}
    }
    console.log('✅ add_metadata_costcap migration done');
  },

  down: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    for (const name of ['idx_msg_shop_costcap', 'idx_msg_shop_date']) {
      try { await qi.removeIndex('messages', name); } catch (_) {}
    }
    try { await qi.removeColumn('messages', 'cost_cap_status'); } catch (_) {}
    try { await qi.removeColumn('messages', 'metadata'); } catch (_) {}
  }
};

/**
 * HOW TO VERIFY THIS MIGRATION WORKED
 * 
 * After running: npm run db:migrate:dev
 * 
 * Check structure:
 *   mysql> DESC messages;
 *   Look for: metadata (JSON), cost_cap_status (ENUM)
 * 
 * Check indexes:
 *   mysql> SHOW INDEXES FROM messages WHERE Key_name LIKE 'idx_msg_%';
 *   Expected: idx_msg_shop_costcap, idx_msg_shop_date
 * 
 * Check enum:
 *   mysql> SHOW COLUMNS FROM messages LIKE 'cost_cap_status';
 *   Expected: ENUM('PENDING','LLM_CALLS_1','LLM_CALLS_2','ESCALATED','RESOLVED')
 * 
 * Test insert:
 *   mysql> INSERT INTO messages (shop_id, conversation_id, content, metadata, cost_cap_status)
 *          VALUES (1, 1, 'test', JSON_OBJECT('llmCallCount', 0), 'PENDING');
 *   SELECT * FROM messages WHERE id = LAST_INSERT_ID();
 *   Expected: metadata and cost_cap_status populated
 */
