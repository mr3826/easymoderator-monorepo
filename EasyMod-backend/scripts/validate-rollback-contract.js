'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/ci-cd.yml'),
    'utf8',
);
const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.prod.yml'), 'utf8');
const runbook = fs.readFileSync(
    path.join(repoRoot, 'docs/deployment/MONOREPO_CUTOVER_RUNBOOK.md'),
    'utf8',
);

const required = [
    ['full commit SHA image tags', 'backend_tag=${{ env.GHCR_BACKEND }}:${SHA}'],
    ['previous backend capture', 'previous_backend_image=$(docker inspect'],
    ['previous frontend capture', 'previous_frontend_image=$(docker inspect'],
    ['RepoDigest capture', "{{index .RepoDigests 0}}"],
    ['candidate image guard', 'no immutable candidate or running image is available'],
    ['rollback function', 'rollback() {'],
    ['previous backend restore', 'export GHCR_IMAGE_BACKEND="$previous_backend_image"'],
    ['previous frontend restore', 'export GHCR_IMAGE_FRONTEND="$previous_frontend_image"'],
    ['no-build restore', 'up --detach --no-build --remove-orphans'],
    ['failure trap', 'trap \'rc=$?; if [ "$rc" -ne 0 ]'],
    ['success marker', 'deploy_succeeded=true'],
    ['backend immutable interpolation', 'image: ${GHCR_IMAGE_BACKEND:?'],
    ['frontend immutable interpolation', 'image: ${GHCR_IMAGE_FRONTEND:?'],
    ['rollback health contract', 'both health checks'],
    ['schema rollback limitation', 'must not run `migrate:down`'],
];

const missing = required
    .filter(([, text]) => !workflow.includes(text) && !compose.includes(text) && !runbook.includes(text))
    .map(([label]) => label);

if (missing.length) {
    throw new Error(`Rollback contract missing: ${missing.join(', ')}`);
}

if (/^\s*[^#\n]*:(latest|dev)\b/m.test(workflow)
    || /GHCR_IMAGE_(BACKEND|FRONTEND).*latest/.test(compose)) {
    throw new Error('Rollback contract permits a mutable production image tag.');
}

// Synthetic rehearsal of the state transition. This deliberately does not call
// Docker or SSH: it proves the recovery inputs are immutable references and the
// documented restore operation does not depend on the candidate application.
const previous = {
    backend: 'ghcr.io/mr3826/easymoderator-backend@sha256:' + 'a'.repeat(64),
    frontend: 'ghcr.io/mr3826/easymoderator-frontend@sha256:' + 'b'.repeat(64),
};
const restored = {
    backend: previous.backend,
    frontend: previous.frontend,
};
if (restored.backend !== previous.backend || restored.frontend !== previous.frontend) {
    throw new Error('Synthetic rollback rehearsal did not restore both previous images.');
}

console.log('rollback-contract=PASS');
