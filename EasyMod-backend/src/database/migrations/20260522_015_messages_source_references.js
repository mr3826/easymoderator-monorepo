'use strict';

/**
 * Migration: 20260522_015_messages_source_references
 *
 * Adds messages.source_references JSONB to surface the RAG documents / FAQ entries
 * that grounded an AI reply. Lets agents reviewing AI messages in the inbox see
 * which knowledge sources drove the answer — directly addresses the architect's
 * §16 "AI Confidence System" gap on source_references and helps detect / debug
 * hallucinations (paired with messages.ai_confidence already on the row).
 *
 * Shape (array of objects):
 *   [{ kind: 'rag'|'faq'|'product', id?: string, title?: string, score?: number }, ...]
 *
 * NULL means "not applicable" (non-AI messages, or AI replies that did not use
 * any grounding source — e.g. greeting fast-path, cache hit).
 */

module.exports = {
    name: '20260522_015_messages_source_references',

    up: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS source_references JSONB NULL;
        `);
        console.log('[migration 015] Added messages.source_references (JSONB NULL).');

        console.log('[migration] 20260522_015_messages_source_references: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query(`
            ALTER TABLE messages DROP COLUMN IF EXISTS source_references;
        `);
        console.log('[migration 015 DOWN] Dropped messages.source_references.');

        console.log('[migration] 20260522_015_messages_source_references: DOWN complete');
    }
};
