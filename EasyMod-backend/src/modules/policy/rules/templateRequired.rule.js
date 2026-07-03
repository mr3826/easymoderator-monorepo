/**
 * templateRequired rule
 *
 * Pairs with twentyFourHourWindow: if we're outside the 24h messaging window,
 * hard-deny. Legacy Messenger message tags are disabled for the BD launch until
 * a current Meta-compliant template/messaging path is implemented and approved
 * for production use.
 *
 * Reads the running augment object that prior rules contributed to (the engine
 * merges augment per step). within_window=false = DENY.
 */

'use strict';

const ALLOWED_TAGS = new Set();

module.exports = {
    name: 'templateRequired',

    async evaluate(_message, ctx) {
        const augment = ctx.runningAugment || {};
        const withinWindow = augment.within_window !== false ? true : false;
        if (withinWindow) return { allow: true, reason: 'WITHIN_WINDOW' };

        return { allow: false, reason: 'OUTSIDE_24H_TEMPLATES_DISABLED' };
    },
};

module.exports.ALLOWED_TAGS = ALLOWED_TAGS;
