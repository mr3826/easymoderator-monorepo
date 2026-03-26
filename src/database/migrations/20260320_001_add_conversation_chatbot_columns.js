'use strict';

/**
 * Migration: Add chatbot-required columns to conversations and messages tables
 *
 * The conversations table was originally created by Sequelize sync() before
 * migration system was established. The Sequelize model now defines
 * role, message, intent, confidence, llm_used, cache_hit, keyword_match, metadata
 * columns that may not exist in production database.
 *
 * Idempotent: each statement is wrapped in try/catch so re-running is safe.
 * Uses SQLite compatible syntax.
 */

module.exports = {
  name: '20260320_001_add_conversation_chatbot_columns',

  up: async (sequelize) => {
    const alreadyExists = (e) =>
      /duplicate column/i.test(e.message) ||
      /already exists/i.test(e.message) ||
      /column.*already exists/i.test(e.message);

    const dialect = sequelize.getDialect();
    
    // ── 1. conversations table columns ───────────────────────────────────

    // role: required for chatbot message classification (NOT NULL, TEXT for SQLite)
    try {
      if (dialect === 'postgres') {
        await sequelize.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_conversations_role') THEN
              CREATE TYPE "enum_conversations_role" AS ENUM('user', 'assistant', 'system');
            END IF;
          END$$;
        `);
        await sequelize.query(
          `ALTER TABLE conversations ADD COLUMN role "enum_conversations_role" NOT NULL DEFAULT 'user'`
        );
      } else {
        // SQLite uses TEXT with CHECK constraint for ENUM simulation
        await sequelize.query(
          `ALTER TABLE conversations ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'assistant', 'system'))`
        );
      }
      console.log('  ✓ conversations.role added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.role already exists, skipping');
      } else {
        throw err;
      }
    }

    // message: triggering message content for this conversation (NOT NULL, TEXT)
    try {
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN message TEXT NOT NULL DEFAULT ''`
      );
      console.log('  ✓ conversations.message added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.message already exists, skipping');
      } else {
        throw err;
      }
    }

    // intent: last detected intent
    try {
      await sequelize.query(`ALTER TABLE conversations ADD COLUMN intent VARCHAR(50)`);
      console.log('  ✓ conversations.intent added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.intent already exists, skipping');
      } else {
        throw err;
      }
    }

    // confidence: intent confidence score
    try {
      await sequelize.query(`ALTER TABLE conversations ADD COLUMN confidence INTEGER`);
      console.log('  ✓ conversations.confidence added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.confidence already exists, skipping');
      } else {
        throw err;
      }
    }

    // llm_used, cache_hit, keyword_match: routing flags
    try {
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN llm_used BOOLEAN NOT NULL DEFAULT FALSE`
      );
      console.log('  ✓ conversations.llm_used added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.llm_used already exists, skipping');
      } else {
        throw err;
      }
    }

    try {
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN cache_hit BOOLEAN NOT NULL DEFAULT FALSE`
      );
      console.log('  ✓ conversations.cache_hit added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.cache_hit already exists, skipping');
      } else {
        throw err;
      }
    }

    try {
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN keyword_match BOOLEAN NOT NULL DEFAULT FALSE`
      );
      console.log('  ✓ conversations.keyword_match added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.keyword_match already exists, skipping');
      } else {
        throw err;
      }
    }

    // metadata JSON column (JSON for SQLite, JSONB for PostgreSQL)
    try {
      const jsonType = dialect === 'postgres' ? 'JSONB' : 'JSON';
      await sequelize.query(
        `ALTER TABLE conversations ADD COLUMN metadata ${jsonType} DEFAULT '{}'`
      );
      console.log('  ✓ conversations.metadata added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.metadata already exists, skipping');
      } else {
        throw err;
      }
    }

    // ── 3. messages table columns ────────────────────────────────────────

    // ai_suggestion and ai_confidence for storing model outputs
    try {
      await sequelize.query(`ALTER TABLE messages ADD COLUMN ai_suggestion TEXT`);
      console.log('  ✓ messages.ai_suggestion added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · messages.ai_suggestion already exists, skipping');
      } else {
        throw err;
      }
    }

    try {
      await sequelize.query(`ALTER TABLE messages ADD COLUMN ai_confidence DECIMAL(3,2)`);
      console.log('  ✓ messages.ai_confidence added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · messages.ai_confidence already exists, skipping');
      } else {
        throw err;
      }
    }
  },

  down: async (sequelize) => {
    console.log('  ⚠️  down() is a no-op: drop columns/types manually if needed');
  }
};
