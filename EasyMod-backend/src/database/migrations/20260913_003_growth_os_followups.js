'use strict';

// Minimum practical follow-up system for the Growth Workspace (§24):
// one row per planned operator action on a prospect, with owner, due time,
// open/completed/cancelled state, and overdue derivable from due_at.

module.exports = {
  name: '20260913_003_growth_os_followups',

  up: async (sequelize) => {
    const postgres = sequelize.getDialect() === 'postgres';
    const uuid = postgres ? 'UUID' : 'TEXT';
    const uuidDefault = postgres ? ' DEFAULT gen_random_uuid()' : '';
    const timestamp = postgres ? 'TIMESTAMPTZ' : 'DATETIME';

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS growth_os_followups (
        id ${uuid}${uuidDefault} PRIMARY KEY,
        prospect_id ${uuid} NOT NULL REFERENCES growth_os_prospects(id) ON DELETE CASCADE,
        owner_user_id ${uuid} REFERENCES users(id) ON DELETE SET NULL,
        created_by ${uuid} REFERENCES users(id) ON DELETE SET NULL,
        due_at ${timestamp} NOT NULL,
        action VARCHAR(200) NOT NULL,
        note TEXT,
        status VARCHAR(16) NOT NULL DEFAULT 'open'
          CONSTRAINT growth_os_followups_status_check CHECK (status IN ('open', 'completed', 'cancelled')),
        completed_at ${timestamp},
        completed_by ${uuid} REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT growth_os_followups_completion_check
          CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
        created_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
        updated_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'}
      );
    `);

    const statements = [
      'CREATE INDEX IF NOT EXISTS growth_os_followups_owner_open_due_idx ON growth_os_followups (owner_user_id, due_at) WHERE status = \'open\';',
      'CREATE INDEX IF NOT EXISTS growth_os_followups_prospect_open_idx ON growth_os_followups (prospect_id, due_at) WHERE status = \'open\';',
      'CREATE INDEX IF NOT EXISTS growth_os_followups_status_due_idx ON growth_os_followups (status, due_at);',
    ];

    for (const statement of statements) {
      await sequelize.query(statement);
    }
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS growth_os_followups;');
  },
};
