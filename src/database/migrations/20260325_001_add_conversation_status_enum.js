'use strict';

/**
 * Migration: Add conversation status ENUM and init status logic
 *
 * Adds supported status values:
 *   - active: conversation ongoing, no response yet
 *   - unanswered: customer message unanswered for >30min
 *   - pending_order: order in draft/pending state attached to conversation
 *   - completed: order completed or conversation marked resolved
 *   - followed_up: agent has engaged with follow-up message
 *
 * Idempotent: checks for existing constraint before creating
 */

module.exports = {
  name: '20260325_001_add_conversation_status_enum',

  up: async (sequelize) => {
    const alreadyExists = (e) =>
      /constraint|already exists|duplicate/i.test(e.message);

    // Add CHECK constraint for status values
    try {
      await sequelize.query(`
        ALTER TABLE conversations 
        ADD CONSTRAINT conversation_status_check 
        CHECK (status IN ('active', 'unanswered', 'pending_order', 'completed', 'followed_up'))
      `);
      console.log('  ✓ conversations.status constraint added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.status constraint already exists, skipping');
      } else {
        throw err;
      }
    }

    // Add index for faster filtering by status
    try {
      await sequelize.query(`
        CREATE INDEX idx_conversations_shop_status 
        ON conversations(shop_id, status)
      `);
      console.log('  ✓ conversations status index added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations status index already exists, skipping');
      } else {
        throw err;
      }
    }
  },

  down: async (sequelize) => {
    try {
      await sequelize.query(
        `ALTER TABLE conversations DROP CONSTRAINT conversation_status_check`
      );
      console.log('  ✓ conversations.status constraint removed');
    } catch (err) {
      console.log('  · conversations.status constraint already removed or never existed');
    }

    try {
      await sequelize.query(
        `DROP INDEX IF EXISTS idx_conversations_shop_status`
      );
      console.log('  ✓ conversations status index removed');
    } catch (err) {
      console.log('  · conversations status index already removed or never existed');
    }
  }
};
