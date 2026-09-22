'use strict';

// Internal notes for prospect / merchant / shop operational context (§34).
// Polymorphic target by design: the service layer proves the target exists
// (prospect | user | shop) before insert, matching the internal-only audit
// trail. Notes are never readable from any merchant-facing route.

module.exports = {
  name: '20260913_004_growth_os_notes',

  up: async (sequelize) => {
    const postgres = sequelize.getDialect() === 'postgres';
    const uuid = postgres ? 'UUID' : 'TEXT';
    const uuidDefault = postgres ? ' DEFAULT gen_random_uuid()' : '';
    const timestamp = postgres ? 'TIMESTAMPTZ' : 'DATETIME';

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS growth_os_notes (
        id ${uuid}${uuidDefault} PRIMARY KEY,
        target_type VARCHAR(16) NOT NULL
          CONSTRAINT growth_os_notes_target_type_check CHECK (target_type IN ('prospect', 'user', 'shop')),
        target_id ${uuid} NOT NULL,
        author_user_id ${uuid} REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
        updated_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'}
      );
    `);

    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS growth_os_notes_target_created_idx ON growth_os_notes (target_type, target_id, created_at DESC);',
    );
    await sequelize.query(
      'CREATE INDEX IF NOT EXISTS growth_os_notes_author_idx ON growth_os_notes (author_user_id, created_at DESC);',
    );
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS growth_os_notes;');
  },
};
