'use strict';

// These strings are transcribed from CONVERSATION_RECOVERY_POLICY.md §4.
const HOLDING_TEMPLATES = Object.freeze({
    RETRIEVAL_FAILURE: Object.freeze({
        en: 'I cannot verify that information right now. A person will check it.',
        banglish: 'Ekhon information ta verify korte parchi na. Ekjon team member check korbe.',
    }),
    ACTION_DENIED: Object.freeze({
        en: 'I could not safely complete that request. A person will help you.',
        banglish: 'Request ta safely complete korte parini. Ekjon team member help korbe.',
    }),
    PROVIDER_DELAY: Object.freeze({
        en: 'I am checking the latest status. A person will follow up if needed.',
        banglish: 'Latest status check korchi. Dorkar hole team member follow up korbe.',
    }),
    INDETERMINATE_MUTATION: Object.freeze({
        en: 'I am checking whether the request completed. Please wait for the confirmed reference.',
        banglish: 'Request ta complete hoyeche kina check korchi. Confirmed reference na paoa porjonto opekkha korun.',
    }),
    HUMAN_HANDOFF: Object.freeze({
        en: 'I have sent this to the shop team. They will review the conversation.',
        banglish: 'Shop team-er kache pathiyechi. Tara conversation ta review korbe.',
    }),
});

const normalizeReason = (reason) => String(reason || 'HUMAN_HANDOFF')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');

const getHoldingTemplate = (reason, language = 'en') => {
    const template = HOLDING_TEMPLATES[normalizeReason(reason)] || HOLDING_TEMPLATES.HUMAN_HANDOFF;
    return template[language === 'en' ? 'en' : 'banglish'];
};

module.exports = { HOLDING_TEMPLATES, getHoldingTemplate, normalizeReason };
