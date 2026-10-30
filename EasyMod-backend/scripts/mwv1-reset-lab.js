'use strict';

// DEMO-HYGIENE ONLY. Resets drifted claim/note/tag state in a LAB database so the
// founder walkthrough can be re-run. It hard-deletes CRM rows and clears
// ownership, so it REFUSES to run unless the target database is unmistakably a
// local lab/dev database (name must contain "dev" or "lab" or "test") AND
// NODE_ENV is not production. Never point DATABASE_URL at a real shop DB.

const { sequelize } = require('../src/utils/database/database-setup');

const dbName = process.env.DATABASE_URL
    ? decodeURIComponent((process.env.DATABASE_URL.split('/').pop() || '').split('?')[0])
    : '';
const isLabDb = /(dev|lab|test)/i.test(dbName);

if (process.env.NODE_ENV === 'production' || !isLabDb) {
    // eslint-disable-next-line no-console
    console.error(`REFUSED: mwv1-reset-lab is lab-only (NODE_ENV=${process.env.NODE_ENV || 'unset'}, db="${dbName || 'unknown'}"). `
        + 'Set DATABASE_URL to a *_dev/_lab/_test database to proceed.');
    process.exit(1);
}

(async () => {
    await sequelize.query("UPDATE conversations SET assignee_id = NULL, hitl = TRUE, resolution_note = NULL, resolved_at = NULL WHERE channel = 'messenger'");
    await sequelize.query('DELETE FROM customer_notes');
    await sequelize.query('DELETE FROM customer_tag_assignments');
    await sequelize.query('DELETE FROM customer_tag_definitions');
    // eslint-disable-next-line no-console
    console.log(`RESET_OK (lab db "${dbName}")`);
    await sequelize.close();
})().catch((e) => { console.error('RESET_FAIL', e.message); process.exit(1); });
