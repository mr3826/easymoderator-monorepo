'use strict';

const AI_REPLY_MODES = Object.freeze({
    AUTO: 'AUTO',
    DRAFT: 'DRAFT',
    MANUAL: 'MANUAL',
});

const DEFAULT_AI_REPLY_MODE = AI_REPLY_MODES.MANUAL;

// Legacy values are accepted at the boundary and always resolve to a
// canonical business mode.
const AI_REPLY_MODE_INPUTS = Object.freeze({
    [AI_REPLY_MODES.AUTO]: AI_REPLY_MODES.AUTO,
    AI_ACTIVE: AI_REPLY_MODES.AUTO,
    [AI_REPLY_MODES.DRAFT]: AI_REPLY_MODES.DRAFT,
    AI_SUGGEST_ONLY: AI_REPLY_MODES.DRAFT,
    [AI_REPLY_MODES.MANUAL]: AI_REPLY_MODES.MANUAL,
    HUMAN_ACTIVE: AI_REPLY_MODES.MANUAL,
});

const normalizeModeInput = (value) => (
    typeof value === 'string' ? value.trim() : null
);

const hasKnownModeInput = (value) => {
    const input = normalizeModeInput(value);
    return input !== null && Object.prototype.hasOwnProperty.call(AI_REPLY_MODE_INPUTS, input);
};

const normalizeAiReplyMode = (value) => {
    const input = normalizeModeInput(value);
    if (input !== null && Object.prototype.hasOwnProperty.call(AI_REPLY_MODE_INPUTS, input)) {
        return AI_REPLY_MODE_INPUTS[input];
    }
    return DEFAULT_AI_REPLY_MODE;
};

const getEffectiveAiReplyMode = async (shopId) => {
    try {
        // shop.service imports shop-defaults, which imports this module. Keep
        // this dependency lazy so initialization does not form a cycle.
        const { getShopAiSettings } = require('./shop.service');
        const settings = await getShopAiSettings(shopId);
        return normalizeAiReplyMode(settings?.automation_mode);
    } catch (_error) {
        return DEFAULT_AI_REPLY_MODE;
    }
};

const isAutoSendMode = (mode) => normalizeAiReplyMode(mode) === AI_REPLY_MODES.AUTO;

const isNonDeliveringMode = (mode) => {
    const normalizedMode = normalizeAiReplyMode(mode);
    return normalizedMode === AI_REPLY_MODES.DRAFT || normalizedMode === AI_REPLY_MODES.MANUAL;
};

module.exports = {
    AI_REPLY_MODES,
    DEFAULT_AI_REPLY_MODE,
    normalizeAiReplyMode,
    getEffectiveAiReplyMode,
    isAutoSendMode,
    isNonDeliveringMode,
    isKnownAiReplyMode: hasKnownModeInput,
};
