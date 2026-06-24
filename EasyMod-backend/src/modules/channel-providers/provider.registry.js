/**
 * provider.registry.js
 *
 * Single source of truth for resolving a platform string to its ChannelProvider.
 * All call-sites MUST go through getProvider() rather than instantiating providers directly.
 *
 * To add a new channel:
 *   1. Implement a ChannelProvider subclass in ./providers/
 *   2. Register it below
 *
 * WhatsApp and Instagram are intentionally absent — out of product scope for
 * the Facebook-only launch (Instagram removed 2026-06-24).
 */

'use strict';

const MetaMessengerProvider = require('./providers/MetaMessengerProvider');

const messenger = new MetaMessengerProvider();

const providers = Object.freeze({
    facebook: messenger
});

/**
 * Get the provider for a given platform string.
 * @param {'facebook'} platform
 * @returns {ChannelProvider}
 * @throws {Error} If platform is not registered.
 */
function getProvider(platform) {
    const p = providers[platform];
    if (!p) {
        throw new Error(`Unsupported platform: ${platform}. Registered: ${Object.keys(providers).join(', ')}`);
    }
    return p;
}

/**
 * List the platforms registered in the registry.
 * @returns {string[]}
 */
function listProviders() {
    return Object.keys(providers);
}

module.exports = { getProvider, listProviders };
