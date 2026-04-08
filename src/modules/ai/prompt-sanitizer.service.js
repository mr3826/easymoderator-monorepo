'use strict';

/**
 * Input guard: BD F-commerce customers ask simple questions in 3-8 turns.
 * Real messages are short. If the input exceeds the character limit it's a bot,
 * a troll, or a copy-paste attack — not a customer buying a saree.
 */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Returns true if the message exceeds the character limit.
 * @param {string} message
 * @returns {boolean}
 */
function isTooLong(message) {
    return typeof message === 'string' && message.length > MAX_MESSAGE_LENGTH;
}

module.exports = { isTooLong, MAX_MESSAGE_LENGTH };
