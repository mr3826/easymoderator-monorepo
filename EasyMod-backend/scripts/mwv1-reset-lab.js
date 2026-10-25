'use strict';
const { sequelize } = require('../src/utils/database/database-setup');
(async () => {
    await sequelize.query("UPDATE conversations SET assignee_id = NULL, hitl = TRUE, resolution_note = NULL, resolved_at = NULL WHERE channel = 'messenger'");
    await sequelize.query('DELETE FROM customer_notes');
    await sequelize.query('DELETE FROM customer_tag_assignments');
    await sequelize.query('DELETE FROM customer_tag_definitions');
    console.log('RESET_OK');
    await sequelize.close();
})().catch((e) => { console.error('RESET_FAIL', e.message); process.exit(1); });
