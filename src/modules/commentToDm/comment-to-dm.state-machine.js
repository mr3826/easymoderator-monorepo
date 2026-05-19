'use strict';

/**
 * CommentToDm State Machine — pure functions, no side effects.
 *
 * Transition table per Phase 4 plan:
 *
 *   COMMENT_RECEIVED → MATCHED | BLOCKED | FAILED
 *   MATCHED          → PUBLIC_REPLY_QUEUED | DM_INVITE_SENT | FAILED
 *   PUBLIC_REPLY_QUEUED → PUBLIC_REPLIED | FAILED
 *   PUBLIC_REPLIED   → DM_INVITE_SENT | FAILED
 *   DM_INVITE_SENT   → CUSTOMER_OPENED_DM | EXPIRED | FAILED
 *   CUSTOMER_OPENED_DM → AUTOMATION_UNLOCKED | EXPIRED | FAILED
 *
 *   Terminal states (no outbound edges):
 *   AUTOMATION_UNLOCKED, EXPIRED, FAILED, BLOCKED
 *
 * Callers: service throws InvalidTransitionError when canTransition returns false.
 * The state machine itself does NOT throw — it is pure and side-effect-free.
 */

/** @type {Record<string, string[]>} */
const TRANSITIONS = {
    COMMENT_RECEIVED:    ['MATCHED', 'BLOCKED', 'FAILED'],
    MATCHED:             ['PUBLIC_REPLY_QUEUED', 'DM_INVITE_SENT', 'FAILED'],
    BLOCKED:             [],
    PUBLIC_REPLY_QUEUED: ['PUBLIC_REPLIED', 'FAILED'],
    PUBLIC_REPLIED:      ['DM_INVITE_SENT', 'FAILED'],
    DM_INVITE_SENT:      ['CUSTOMER_OPENED_DM', 'EXPIRED', 'FAILED'],
    CUSTOMER_OPENED_DM:  ['AUTOMATION_UNLOCKED', 'EXPIRED', 'FAILED'],
    AUTOMATION_UNLOCKED: [],
    EXPIRED:             [],
    FAILED:              [],
};

const KNOWN_STATES = new Set(Object.keys(TRANSITIONS));

/**
 * canTransition(from, to)
 *
 * Returns true if `to` is a valid successor of `from` in the state machine.
 * Returns false for any unknown state or illegal edge — never throws.
 *
 * @param {string|null} from
 * @param {string|null} to
 * @returns {boolean}
 */
function canTransition(from, to) {
    if (!from || !to) return false;
    const allowed = TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
}

/**
 * validTransitions(from)
 *
 * Returns the list of reachable next states from `from`.
 * Throws if `from` is not a recognised state.
 *
 * @param {string} from
 * @returns {string[]}
 */
function validTransitions(from) {
    if (!KNOWN_STATES.has(from)) {
        throw new Error(`CommentToDm state machine: unknown state "${from}"`);
    }
    return [...TRANSITIONS[from]];
}

module.exports = { TRANSITIONS, canTransition, validTransitions };
