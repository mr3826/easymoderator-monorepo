'use strict';

const rule = require('../rules/businessHours.rule');
const { AI_REPLY_MODES } = require('../../shop/ai-reply-mode');

const outsideHours = {};

describe('businessHours.rule reply modes', () => {
    test.each([
        AI_REPLY_MODES.AUTO,
        'AI_ACTIVE',
    ])('downgrades %s outside business hours', async (automationMode) => {
        const result = await rule.evaluate({}, {
            settings: {
                automation_mode: automationMode,
                business_hours: outsideHours,
            },
        });

        expect(result).toEqual(expect.objectContaining({
            allow: false,
            reason: 'SUGGEST_ONLY',
        }));
    });

    test.each([
        AI_REPLY_MODES.DRAFT,
        'AI_SUGGEST_ONLY',
        AI_REPLY_MODES.MANUAL,
        'HUMAN_ACTIVE',
    ])('does not downgrade %s outside business hours', async (automationMode) => {
        const result = await rule.evaluate({}, {
            settings: {
                automation_mode: automationMode,
                business_hours: outsideHours,
            },
        });

        expect(result).toEqual(expect.objectContaining({
            allow: true,
            reason: 'OUTSIDE_HOURS_NON_AI',
        }));
    });
});
