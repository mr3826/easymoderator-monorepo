'use strict';

// Growth workflow expansion:
//  - prospect statuses: add 'onboarding' (qualified -> onboarding -> activated)
//  - lead sources: controlled taxonomy for manual/extension/channel capture
//  - prospect events: types required by follow-ups, notes, and activation
// All three changes replace a CHECK list with a superset; historical rows are
// untouched, and down() refuses to revert while new values are in use.

const STATUSES = [
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'onboarding',
  'disqualified',
  'unreachable',
  'converted',
  'merged',
];

const LEGACY_STATUSES = [
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'disqualified',
  'unreachable',
  'converted',
  'merged',
];

const SOURCES = [
  'self_signup',
  'partner_form',
  'manual_entry',
  'referral_mention',
  'inbound_message',
  'event',
  'browser_extension',
  'facebook',
  'facebook_group',
  'website',
  'linkedin',
  'partner',
  'paid',
  'other',
];

const LEGACY_SOURCES = [
  'self_signup',
  'partner_form',
  'manual_entry',
  'referral_mention',
  'inbound_message',
  'event',
  'other',
];

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
  'note_added',
  'activated',
];

const LEGACY_EVENT_TYPES = [
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
];

const quote = (values) => values.map((value) => `'${value}'`).join(', ');

async function replaceCheck(sequelize, table, constraintName, column, values) {
  await sequelize.query(
    `ALTER TABLE ${table} DROP CONSTRAINT ${constraintName}`,
  );
  await sequelize.query(
    `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${column} IN (${quote(values)}))`,
  );
}

async function assertNoValuesInUse( sequelize, table, column, allowed, label) {
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
  async up(sequelize) {
    if (sequelize.getDialect() !== 'postgres') {
      console.log('[20260913_002] named CHECK replacement skipped on non-PostgreSQL dialect');
      return;
    }
    await replaceCheck(
      sequelize, 'growth_os_prospects', 'growth_os_prospects_status_check', 'status', STATUSES,
    );
    await replaceCheck(
      sequelize, 'growth_os_prospects', 'growth_os_prospects_source_check', 'source', SOURCES,
    );
    await replaceCheck(
      sequelize, 'growth_os_prospect_events', 'growth_os_prospect_events_type_check', 'event_type', EVENT_TYPES,
    );
  },

  async down(sequelize) {
    if (sequelize.getDialect() !== 'postgres') return;
    await assertNoValuesInUse(
      sequelize, 'growth_os_prospects', 'status', LEGACY_STATUSES, 'status',
    );
    await assertNoValuesInUse(
      sequelize, 'growth_os_prospects', 'source', LEGACY_SOURCES, 'source',
    );
    await assertNoValuesInUse(
      sequelize, 'growth_os_prospect_events', 'event_type', LEGACY_EVENT_TYPES, 'event_type',
    );
    await replaceCheck(
      sequelize, 'growth_os_prospects', 'growth_os_prospects_status_check', 'status', LEGACY_STATUSES,
    );
    await replaceCheck(
      sequelize, 'growth_os_prospects', 'growth_os_prospects_source_check', 'source', LEGACY_SOURCES,
    );
    await replaceCheck(
      sequelize, 'growth_os_prospect_events', 'growth_os_prospect_events_type_check', 'event_type', LEGACY_EVENT_TYPES,
    );
  },
};
