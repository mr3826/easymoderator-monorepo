'use strict';

/**
 * Migration: Add hitl column to conversations, message_tag column to messages
 *
 * hitl (Human-In-The-Loop): boolean flag — when true the agent has taken over
 *   and the AI chatbot must skip auto-replies for this conversation.
 *
 * message_tag: stores the Meta message tag used for out-of-24h-window messages
 *   (CONFIRMED_EVENT_UPDATE | POST_PURCHASE_UPDATE | ACCOUNT_UPDATE | HUMAN_AGENT)
 *   Required for Meta policy compliance audit trail.
 *
 * Idempotent: each statement is wrapped in try/catch so re-running is safe.
 */

module.exports = {
  name: '20260320_004_add_hitl_and_message_tag',

  up: async (sequelize) => {
    const alreadyExists = (e) =>
      /duplicate column/i.test(e.message) ||
      /already exists/i.test(e.message) ||
      /column.*already exists/i.test(e.message);

    // ── conversations.hitl ───────────────────────────────────────────────
    try {
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN hitl BOOLEAN NOT NULL DEFAULT FALSE`
      );
      console.log('  ✓ conversations.hitl added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.hitl already exists, skipping');
      } else {
        throw err;
      }
    }

    // ── messages.message_tag ─────────────────────────────────────────────
    try {
      await sequelize.query(
        `ALTER TABLE messages ADD COLUMN message_tag VARCHAR(50)`
      );
      console.log('  ✓ messages.message_tag added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · messages.message_tag already exists, skipping');
      } else {
        throw err;
      }
    }
  },

  down: async (sequelize) => {
    console.log('  ⚠️  down() is a no-op: drop columns manually if needed');
  }
};
