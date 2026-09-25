'use strict';

// Follow-up cancellation integrity:
// cancellation is now a terminal transition that records a prospect timeline
// event, so 'followup_cancelled' joins the event-type CHECK list as a
// superset. Historical rows are untouched, and down() refuses to revert
// while the new value is in use (same pattern as 20260913_002).

const EVENT_TYPES = [
  'created',
  'updated',
  'status_changed',
  'assigned',
  'unassigned',
  'linked',
  'unlinked',
  'merged',
  'merge_target',
  'imported',
  'followup_created',
  'followup_completed',
  'followup_cancelled',
  'note_added',
  'activated',
];

const PRIOR_EVENT_TYPES = EVENT_TYPES.filter((type) => type !== 'followup_cancelled');

const quote = (values) => values.map((value) => `'${value}'`).join(', ');

async function replaceCheck(sequelize, table, constraintName, column, values) {
  await sequelize.query(
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraintName}`,
  );
  await sequelize.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${column} IN (${quote(values)}))`,
  );
}

async function assertNoValuesInUse(sequelize, table, column, allowed, label) {
  const [{ count }] = await sequelize.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} NOT IN (${quote(allowed)})`,
    { plain: false },
  );
  if (Number(count) > 0) {
    throw new Error(
      `Cannot roll back: rows using new ${label} values exist (count=${count})`,
    );
  }
}

module.exports = {
  name: '20260925_001_growth_os_followup_cancel_event_type',
  async up(sequelize) {
    if (sequelize.getDialect() !== 'postgres') {
      console.log('[20260925_001] named CHECK replacement skipped on non-PostgreSQL dialect');
      return;
    }
    await replaceCheck(
      sequelize, 'growth_os_prospect_events', 'growth_os_prospect_events_type_check', 'event_type', EVENT_TYPES,
    );
  },

  async down(sequelize) {
    if (sequelize.getDialect() !== 'postgres') return;
    await assertNoValuesInUse(
      sequelize, 'growth_os_prospect_events', 'event_type', PRIOR_EVENT_TYPES, 'event_type',
    );
    await replaceCheck(
      sequelize, 'growth_os_prospect_events', 'growth_os_prospect_events_type_check', 'event_type', PRIOR_EVENT_TYPES,
    );
  },
};
