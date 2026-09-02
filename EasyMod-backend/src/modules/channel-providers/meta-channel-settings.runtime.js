'use strict';

// These are the only Page settings that remain meaningful at runtime. Reply
// mode and the legacy AI switch are deliberately excluded from this boundary.
const RUNTIME_CHANNEL_SETTING_KEYS = Object.freeze([
    'business_hours',
    'confidence_threshold_send',
    'confidence_threshold_suggest',
    'allow_order_creation',
    'purpose_label',
]);

function selectChannelRuntimeSettings(settings) {
    const plain = typeof settings?.toJSON === 'function' ? settings.toJSON() : settings;
    if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return {};

    return RUNTIME_CHANNEL_SETTING_KEYS.reduce((selected, key) => {
        if (Object.prototype.hasOwnProperty.call(plain, key)) selected[key] = plain[key];
        return selected;
    }, {});
}

module.exports = { selectChannelRuntimeSettings };
