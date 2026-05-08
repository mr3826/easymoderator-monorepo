/**
 * Branding presets for shop AI personality.
 * Each preset defines tone, emoji usage level, and a default greeting.
 */
const BRANDING_PRESETS = {
    FRIENDLY: {
        tone: 'warm and casual',
        emojiUsage: 'moderate',
        greeting: 'হ্যালো! কীভাবে সাহায্য করতে পারি? 😊'
    },
    PROFESSIONAL: {
        tone: 'formal and concise',
        emojiUsage: 'none',
        greeting: 'আপনাকে স্বাগতম। আমি কীভাবে আপনাকে সাহায্য করতে পারি?'
    },
    FUN: {
        tone: 'playful and energetic',
        emojiUsage: 'heavy',
        greeting: 'হেই! আজকে কী চাই? 🎉🛍️'
    }
};

module.exports = { BRANDING_PRESETS };
