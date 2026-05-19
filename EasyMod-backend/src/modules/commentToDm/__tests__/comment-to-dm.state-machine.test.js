'use strict';

const {
    canTransition,
    validTransitions,
    TRANSITIONS,
} = require('../comment-to-dm.state-machine');

describe('CommentToDm State Machine', () => {

    describe('TRANSITIONS table completeness', () => {
        test('every state listed as a key has an array of allowed next states', () => {
            const allStates = [
                'COMMENT_RECEIVED', 'MATCHED', 'BLOCKED',
                'PUBLIC_REPLY_QUEUED', 'PUBLIC_REPLIED',
                'DM_INVITE_SENT', 'CUSTOMER_OPENED_DM',
                'AUTOMATION_UNLOCKED', 'EXPIRED', 'FAILED',
            ];
            for (const state of allStates) {
                expect(Array.isArray(TRANSITIONS[state])).toBe(true);
            }
        });
    });

    describe('canTransition(from, to)', () => {

        // Valid forward paths
        test('COMMENT_RECEIVED → MATCHED is valid', () => {
            expect(canTransition('COMMENT_RECEIVED', 'MATCHED')).toBe(true);
        });
        test('COMMENT_RECEIVED → BLOCKED is valid', () => {
            expect(canTransition('COMMENT_RECEIVED', 'BLOCKED')).toBe(true);
        });
        test('COMMENT_RECEIVED → FAILED is valid', () => {
            expect(canTransition('COMMENT_RECEIVED', 'FAILED')).toBe(true);
        });
        test('MATCHED → PUBLIC_REPLY_QUEUED is valid', () => {
            expect(canTransition('MATCHED', 'PUBLIC_REPLY_QUEUED')).toBe(true);
        });
        test('MATCHED → DM_INVITE_SENT is valid (skip public reply)', () => {
            expect(canTransition('MATCHED', 'DM_INVITE_SENT')).toBe(true);
        });
        test('PUBLIC_REPLY_QUEUED → PUBLIC_REPLIED is valid', () => {
            expect(canTransition('PUBLIC_REPLY_QUEUED', 'PUBLIC_REPLIED')).toBe(true);
        });
        test('PUBLIC_REPLIED → DM_INVITE_SENT is valid', () => {
            expect(canTransition('PUBLIC_REPLIED', 'DM_INVITE_SENT')).toBe(true);
        });
        test('DM_INVITE_SENT → CUSTOMER_OPENED_DM is valid', () => {
            expect(canTransition('DM_INVITE_SENT', 'CUSTOMER_OPENED_DM')).toBe(true);
        });
        test('DM_INVITE_SENT → EXPIRED is valid', () => {
            expect(canTransition('DM_INVITE_SENT', 'EXPIRED')).toBe(true);
        });
        test('DM_INVITE_SENT → FAILED is valid', () => {
            expect(canTransition('DM_INVITE_SENT', 'FAILED')).toBe(true);
        });
        test('CUSTOMER_OPENED_DM → AUTOMATION_UNLOCKED is valid', () => {
            expect(canTransition('CUSTOMER_OPENED_DM', 'AUTOMATION_UNLOCKED')).toBe(true);
        });
        test('CUSTOMER_OPENED_DM → EXPIRED is valid', () => {
            expect(canTransition('CUSTOMER_OPENED_DM', 'EXPIRED')).toBe(true);
        });

        // Terminal states cannot transition forward
        test('AUTOMATION_UNLOCKED → anything is invalid', () => {
            for (const next of ['MATCHED', 'DM_INVITE_SENT', 'EXPIRED', 'FAILED']) {
                expect(canTransition('AUTOMATION_UNLOCKED', next)).toBe(false);
            }
        });
        test('EXPIRED → anything is invalid', () => {
            expect(canTransition('EXPIRED', 'MATCHED')).toBe(false);
            expect(canTransition('EXPIRED', 'FAILED')).toBe(false);
        });
        test('FAILED → anything is invalid', () => {
            expect(canTransition('FAILED', 'MATCHED')).toBe(false);
        });
        test('BLOCKED → anything is invalid (blocked is terminal)', () => {
            expect(canTransition('BLOCKED', 'MATCHED')).toBe(false);
            expect(canTransition('BLOCKED', 'DM_INVITE_SENT')).toBe(false);
        });

        // Backward / illegal hops
        test('DM_INVITE_SENT → COMMENT_RECEIVED is invalid', () => {
            expect(canTransition('DM_INVITE_SENT', 'COMMENT_RECEIVED')).toBe(false);
        });
        test('MATCHED → COMMENT_RECEIVED is invalid', () => {
            expect(canTransition('MATCHED', 'COMMENT_RECEIVED')).toBe(false);
        });

        // Unknown states
        test('unknown from-state returns false', () => {
            expect(canTransition('UNKNOWN_STATE', 'MATCHED')).toBe(false);
        });
        test('unknown to-state returns false', () => {
            expect(canTransition('COMMENT_RECEIVED', 'UNKNOWN_STATE')).toBe(false);
        });
        test('null inputs return false', () => {
            expect(canTransition(null, 'MATCHED')).toBe(false);
            expect(canTransition('MATCHED', null)).toBe(false);
        });
    });

    describe('validTransitions(from)', () => {
        test('returns array for known state', () => {
            const result = validTransitions('MATCHED');
            expect(Array.isArray(result)).toBe(true);
            expect(result).toContain('PUBLIC_REPLY_QUEUED');
            expect(result).toContain('DM_INVITE_SENT');
        });
        test('returns empty array for terminal state', () => {
            expect(validTransitions('AUTOMATION_UNLOCKED')).toEqual([]);
            expect(validTransitions('EXPIRED')).toEqual([]);
            expect(validTransitions('FAILED')).toEqual([]);
            expect(validTransitions('BLOCKED')).toEqual([]);
        });
        test('throws for unknown state', () => {
            expect(() => validTransitions('NOT_A_STATE')).toThrow();
        });
    });

    describe('throws on invalid transition attempt', () => {
        test('canTransition returns false, caller must throw if desired', () => {
            // The state machine is pure functions — caller is responsible for acting on false.
            // Verify that canTransition itself does NOT throw; throwing is the service's job.
            expect(() => canTransition('BLOCKED', 'MATCHED')).not.toThrow();
            expect(canTransition('BLOCKED', 'MATCHED')).toBe(false);
        });
    });
});
