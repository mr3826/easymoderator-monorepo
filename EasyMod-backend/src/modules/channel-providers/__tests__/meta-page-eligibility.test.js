'use strict';

const {
    META_PAGE_TASKS_REQUIRED,
    normalizePageTasks,
    evaluatePageEligibility,
} = require('../meta-page-eligibility');

describe('Meta Page eligibility', () => {
    test('normalizes case and whitespace and removes duplicate tasks', () => {
        expect(normalizePageTasks([
            ' messaging ',
            'CREATE   CONTENT',
            'MANAGE',
            'manage',
        ])).toEqual(['MESSAGING', 'CREATE_CONTENT', 'MANAGE']);
    });

    test.each([
        ['missing tasks', undefined],
        ['null tasks', null],
        ['non-array tasks', 'MESSAGING'],
    ])('%s are ineligible with a stable reason', (_label, tasks) => {
        expect(evaluatePageEligibility(tasks)).toEqual({
            tasks: [],
            connectable: false,
            reason: META_PAGE_TASKS_REQUIRED,
        });
    });

    test.each([
        ['non-string task entry', ['MESSAGING', 42], ['MESSAGING']],
        ['blank task entry', ['MESSAGING', '  '], ['MESSAGING']],
        ['malformed task entry', ['MESSAGING', 'MANAGE!'], ['MESSAGING']],
    ])('skips a %s while preserving valid tasks', (_label, tasks, expected) => {
        expect(normalizePageTasks(tasks)).toEqual(expected);
    });

    test.each(['CREATE_CONTENT', 'MANAGE', 'MODERATE'])(
        'accepts MESSAGING plus %s',
        (subscriptionTask) => {
            const result = evaluatePageEligibility([' messaging ', subscriptionTask.toLowerCase()]);

            expect(result).toEqual({
                tasks: ['MESSAGING', subscriptionTask],
                connectable: true,
                reason: null,
            });
        },
    );

    test.each([
        ['messaging only', ['MESSAGING']],
        ['subscription task only', ['MANAGE']],
        ['unrelated tasks', ['CREATE_CONTENT', 'MANAGE']],
    ])('%s is ineligible', (_label, tasks) => {
        expect(evaluatePageEligibility(tasks)).toMatchObject({
            connectable: false,
            reason: META_PAGE_TASKS_REQUIRED,
        });
    });
});
