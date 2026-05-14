/**
 * Secrets loader — Digital Ocean deployment.
 *
 * All secrets are supplied via /opt/easymod/.env.prod on the droplet,
 * which is mounted by docker-compose.prod.yml as env_file.
 * This module is a no-op; it exists so call-sites don't need changing.
 */

let loaded = false;

async function loadSecrets() {
    if (loaded) return;
    loaded = true;
}

module.exports = loadSecrets;
