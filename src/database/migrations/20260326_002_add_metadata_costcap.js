// src/database/migrations/20260326_002_add_metadata_costcap.js
// TASK 3: Cost Cap Enforcement (Metadata Schema)
// Purpose: Add tracking for LLM call count per message to enforce 2-call limit
// Owner: Backend Dev
// Effort: 0.5 days
// Deadline: End of Day 2

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('⏳ Starting migration: add_metadata_costcap');

    try {
      // Add metadata JSONB column to Messages table
      // This stores:
      // {
      //   llmCallCount: number,      // Incremented each LLM call
      //   costCapExceeded: boolean,  // True if 2+ calls reached
      //   escalationReason: string,  // Why it was escalated
      //   tokenUsage: {              // Token tracking
      //     inputTokens: number,
      //     outputTokens: number,
      //     totalTokens: number
      //   },
      //   providers: Array,           // Providers tried (for audit trail)
      //   failureHistory: Array       // Failures before escalation
      // }

      console.log('  → Adding metadata JSONB column to messages');
      await queryInterface.addColumn(
        'messages',
        'metadata',
        {
          type: Sequelize.JSON,
          defaultValue: {},
          allowNull: false,
          comment: 'Cost cap tracking, token usage, escalation reasons'
        }
      );

      // Add cost_cap_status column for quick querying
      console.log('  → Adding cost_cap_status column');
      await queryInterface.addColumn(
        'messages',
        'cost_cap_status',
        {
          type: Sequelize.ENUM('PENDING', 'LLM_CALLS_1', 'LLM_CALLS_2', 'ESCALATED', 'RESOLVED'),
          defaultValue: 'PENDING',
          allowNull: false,
          comment: 'Quick status check for cost cap queries'
        }
      );

      // Add index for quick query filtering
      console.log('  → Adding index on shop_id + cost_cap_status');
      await queryInterface.addIndex(
        'messages',
        { fields: ['shop_id', 'cost_cap_status'] },
        {
          name: 'idx_msg_shop_costcap',
          unique: false
        }
      );

      // Add index for created_at to track daily costs
      console.log('  → Adding index on shop_id + created_at');
      await queryInterface.addIndex(
        'messages',
        { fields: ['shop_id', 'created_at'] },
        {
          name: 'idx_msg_shop_date',
          unique: false
        }
      );

      console.log('✅ Migration complete');

    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    console.log('⏳ Rolling back migration: add_metadata_costcap');

    try {
      // Remove indexes first
      console.log('  → Dropping index idx_msg_shop_costcap');
      await queryInterface.removeIndex('messages', 'idx_msg_shop_costcap');

      console.log('  → Dropping index idx_msg_shop_date');
      await queryInterface.removeIndex('messages', 'idx_msg_shop_date');

      // Remove columns
      console.log('  → Removing cost_cap_status column');
      await queryInterface.removeColumn('messages', 'cost_cap_status');

      console.log('  → Removing metadata column');
      await queryInterface.removeColumn('messages', 'metadata');

      console.log('✅ Rollback complete');

    } catch (error) {
      console.error('❌ Rollback failed:', error.message);
      throw error;
    }
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
