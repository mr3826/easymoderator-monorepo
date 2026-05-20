'use strict';

/**
 * Migration: Add conversation resolution + assignment fields
 *
 * - assignee_id    UUID nullable  — shop team member assigned to this conversation
 * - resolution_note TEXT nullable — optional note when closing
 * - resolved_at    TIMESTAMPTZ nullable — timestamp set when status → closed
 *
 * Also extends the status CHECK constraint to include 'closed' and 'archived'.
 * The old constraint (missing 'closed') is dropped and replaced.
 */

module.exports = {
  name: '20260418_001_add_conversation_resolution_fields',

  up: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    const alreadyExists = (e) =>
      /constraint|already exists|duplicate|column.*already/i.test(e.message);

    // 1. assignee_id
    try {
      await qi.addColumn('conversations', 'assignee_id', {
        type: 'UUID',
        allowNull: true,
      });
      console.log('  ✓ conversations.assignee_id added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.assignee_id already exists, skipping');
      } else {
        throw err;
      }
    }

    // 2. resolution_note
    try {
      await qi.addColumn('conversations', 'resolution_note', {
        type: 'TEXT',
        allowNull: true,
      });
      console.log('  ✓ conversations.resolution_note added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.resolution_note already exists, skipping');
      } else {
        throw err;
      }
    }

    // 3. resolved_at
    try {
      await qi.addColumn('conversations', 'resolved_at', {
        type: 'TIMESTAMPTZ',
        allowNull: true,
      });
      console.log('  ✓ conversations.resolved_at added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.resolved_at already exists, skipping');
      } else {
        throw err;
      }
    }

    // 4. Drop old status CHECK constraint (missing 'closed') and add expanded one
    try {
      await sequelize.query(
        `ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversation_status_check`
      );
      console.log('  ✓ old conversations.status constraint dropped');
    } catch (err) {
      console.log('  · could not drop old status constraint (may not exist):', err.message);
    }

    try {
      await sequelize.query(`
        ALTER TABLE conversations
        ADD CONSTRAINT conversation_status_check
        CHECK (status IN ('active', 'unanswered', 'pending_order', 'completed', 'followed_up', 'closed', 'archived'))
      `);
      console.log('  ✓ conversations.status constraint updated (includes closed/archived)');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · conversations.status constraint already up-to-date, skipping');
      } else {
        throw err;
      }
    }
  },

  down: async (sequelize) => {
    const qi = sequelize.getQueryInterface();

    try { await qi.removeColumn('conversations', 'assignee_id'); } catch (_) {}
    try { await qi.removeColumn('conversations', 'resolution_note'); } catch (_) {}
    try { await qi.removeColumn('conversations', 'resolved_at'); } catch (_) {}

    // Restore original narrow constraint
    try {
      await sequelize.query(
        `ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversation_status_check`
      );
      await sequelize.query(`
        ALTER TABLE conversations
        ADD CONSTRAINT conversation_status_check
        CHECK (status IN ('active', 'unanswered', 'pending_order', 'completed', 'followed_up'))
      `);
      console.log('  ✓ conversations.status constraint restored to original');
    } catch (err) {
      console.log('  · could not restore status constraint:', err.message);
    }
  },
};
