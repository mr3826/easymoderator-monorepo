'use strict';

async function assertProductionIntegrations() {
    if (process.env.NODE_ENV !== 'production') return { validated: 0 };
    const { DeliveryIntegration } = require('../modules/entities');
    const integrations = await DeliveryIntegration.findAll({
        where: { is_active: true },
        attributes: ['id', 'provider', 'credentials'],
    });
    const requiredByProvider = {
        steadfast: ['secret_key'],
        redx: ['api_key'],
        pathao: ['client_secret'],
    };
    const invalid = [];
    for (const integration of integrations) {
        const required = requiredByProvider[integration.provider] || [];
        if (required.some((name) => !integration.credentials?.[name])) {
            invalid.push(`${integration.provider}:${integration.id}`);
        }
    }
    if (invalid.length) {
        throw new Error(
            `Active courier integrations lack webhook verification credentials: ${invalid.join(', ')}`,
        );
    }
    return { validated: integrations.length };
}

module.exports = { assertProductionIntegrations };
