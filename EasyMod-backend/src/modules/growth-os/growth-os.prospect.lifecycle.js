'use strict';

const { AppError } = require('../../utils/AppError');

const PROSPECT_STATUSES = Object.freeze([
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'disqualified',
  'unreachable',
  'converted',
  'merged',
]);

const PROSPECT_SOURCES = Object.freeze([
  'self_signup',
  'partner_form',
  'manual_entry',
  'referral_mention',
  'inbound_message',
  'event',
  'other',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  new: Object.freeze(['contacted', 'disqualified', 'unreachable']),
  contacted: Object.freeze(['qualifying', 'disqualified', 'unreachable']),
  qualifying: Object.freeze(['qualified', 'disqualified', 'unreachable']),
  qualified: Object.freeze(['converted', 'disqualified', 'unreachable']),
  disqualified: Object.freeze(['qualifying']),
  unreachable: Object.freeze(['contacted']),
  converted: Object.freeze([]),
  merged: Object.freeze([]),
});

const PROSPECT_EVENT_TYPES = Object.freeze([
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
]);

function isProspectStatus(status) {
  return PROSPECT_STATUSES.includes(status);
}

function isProspectSource(source) {
  return PROSPECT_SOURCES.includes(source);
}

function canTransition(fromStatus, toStatus) {
  return isProspectStatus(fromStatus)
    && isProspectStatus(toStatus)
    && ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

function assertTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new AppError(
      `Invalid prospect lifecycle transition: ${fromStatus} -> ${toStatus}`,
      409,
      'GROWTH_OS_PROSPECT_INVALID_TRANSITION',
    );
  }
  return true;
}

module.exports = {
  PROSPECT_STATUSES,
  PROSPECT_SOURCES,
  PROSPECT_EVENT_TYPES,
  ALLOWED_TRANSITIONS,
  isProspectStatus,
  isProspectSource,
  canTransition,
  assertTransition,
  TRANSITIONS: ALLOWED_TRANSITIONS,
  isValidTransition: canTransition,
};
