'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/ci-cd.yml',
);
const workflow = fs.readFileSync(workflowPath, 'utf8');
const composePath = path.resolve(__dirname, '../../../../docker-compose.prod.yml');
const compose = fs.readFileSync(composePath, 'utf8');

describe('production workflow branch safety', () => {
    test('build and deploy jobs are restricted to main', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(buildBlock).toContain("github.ref == 'refs/heads/main'");
        expect(deployBlock).toContain("github.event_name == 'workflow_dispatch'");
        expect(deployBlock).toContain("github.ref == 'refs/heads/main'");
    });

    test('deploy passes the Action Gate secret to production rendering', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain('AI_ACTION_GATE_SECRET: ${{ secrets.AI_ACTION_GATE_SECRET }}');
    });

    test('pull requests can run tests but cannot build deployable images', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        expect(buildBlock).toContain("github.event_name != 'pull_request'");
    });

    test('every branch validates both production Docker build contexts without publishing', () => {
        const validationBlock = workflow.match(
            /\n  docker-build-validation:\n([\s\S]*?)\n  # ── 3\./,
        )?.[1];

        expect(validationBlock).toContain('Docker build validation (no push)');
        expect(validationBlock).toContain('context: ./EasyMod-backend');
        expect(validationBlock).toContain('context: ./EasyMod-frontend');
        expect(validationBlock.match(/push: false/g)).toHaveLength(2);
        expect(validationBlock.match(/load: true/g)).toHaveLength(2);
        expect(validationBlock).toContain('push: false');
    });

    test('main production path builds each publishable image once', () => {
        const validationBlock = workflow.match(
            /\n  docker-build-validation:\n([\s\S]*?)\n  # ── 3\./,
        )?.[1];
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];

        expect(validationBlock).toContain("github.ref != 'refs/heads/main'");
        expect(buildBlock).not.toContain('docker-build-validation');
        expect(buildBlock.match(/uses: docker\/build-push-action@/g)).toHaveLength(2);
    });

    test('production Compose pins every image by digest', () => {
        expect(compose).not.toMatch(/(^|\n)\s*image:\s*[^\n]*:(latest|dev)(\s|$)/m);
        expect(compose).toContain('image: caddy@sha256:');
        expect(compose).toContain('image: postgres@sha256:');
        expect(compose).toContain('image: redis@sha256:');
        expect(compose).toContain('image: qdrant/qdrant@sha256:');
        expect(workflow).toContain('docker image inspect -f');
        expect(workflow).toContain('config --images');
    });

    // BUILD_TIME lands in the image as ENV and is read back by /health, /version
    // and Sentry's `dist`. It was github.event.repository.updated_at — the repo's
    // last-metadata-change time, which ran behind the commit it labelled and could
    // repeat across two pushes, collapsing two releases onto one dist marker.
    test('stamps BUILD_TIME from the build itself, not repository metadata', () => {
        expect(workflow).not.toContain('repository.updated_at');
        expect(workflow).toContain('BUILD_TIME=${{ steps.meta.outputs.build_time }}');
        expect(workflow).toMatch(/echo "build_time=\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)" >> \$GITHUB_OUTPUT/);
    });

    test('migrates the candidate backend image before replacing running services', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];
        const candidateMigration =
            'run --rm --no-deps -T \\\n                -e RUN_MIGRATIONS_ON_STARTUP=false backend npm run migrate';
        const migrationIndex = deployBlock.indexOf(candidateMigration);
        const schemaAuditIndex = deployBlock.indexOf('npm run schema:audit');
        const replacementIndex = deployBlock.indexOf(
            'up -d --no-build --remove-orphans',
        );

        expect(migrationIndex).toBeGreaterThan(-1);
        expect(schemaAuditIndex).toBeGreaterThan(migrationIndex);
        expect(replacementIndex).toBeGreaterThan(-1);
        expect(schemaAuditIndex).toBeLessThan(replacementIndex);
    });

    test('stamps MIGRATION_START before the candidate migration runs, and proves exactly one repair ledger row before the schema audit', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];
        const candidateMigration =
            'run --rm --no-deps -T \\\n                -e RUN_MIGRATIONS_ON_STARTUP=false backend npm run migrate';

        const migrationStartIndex = deployBlock.indexOf('echo "MIGRATION_START=$migration_started_at"');
        const migrationIndex = deployBlock.indexOf(candidateMigration);
        const ledgerCheckIndex = deployBlock.indexOf('REPAIR_LEDGER_ENTRY_COUNT=1');
        const schemaAuditIndex = deployBlock.indexOf('npm run schema:audit');

        expect(migrationStartIndex).toBeGreaterThan(-1);
        expect(migrationIndex).toBeGreaterThan(-1);
        expect(migrationStartIndex).toBeLessThan(migrationIndex);

        expect(deployBlock).toContain(
            "SELECT COUNT(*) FROM public.migrations WHERE name LIKE '\\''20260901_001_reconcile_commercial_entity_drift%'\\''",
        );
        expect(deployBlock).toContain('test "$repair_ledger_rows" = 1');
        expect(ledgerCheckIndex).toBeGreaterThan(migrationIndex);
        expect(ledgerCheckIndex).toBeLessThan(schemaAuditIndex);

        // MIGRATION_START must be stamped even when the migration block is
        // skipped (WIPE path), since Step 17's log bound cannot be conditional.
        expect(deployBlock.match(/echo "MIGRATION_START=\$migration_started_at"/g)).toHaveLength(2);
    });

    test('the pre-migration schema-drift probe is opt-in per dispatch, not hardcoded', () => {
        expect(workflow).toContain(
            "description: 'One-shot: require the 3 repair columns ABSENT before migrating. Type DRIFT to confirm.'",
        );
        expect(workflow).toMatch(/expect_schema_drift:\n\s+description:/);

        // The literal used to be baked into every dispatch, including ordinary
        // future deploys where the repair columns are already present — that
        // throws PRE_MIGRATION_SCHEMA=FAIL on every deploy after this repair
        // ships. It must only ever be reached through the resolved shell var.
        expect(workflow).not.toMatch(/PROBE_SCHEMA_MODE=pre-migration(?!['"])/);
        expect(workflow.match(/PROBE_SCHEMA_MODE=\$schema_probe_mode/g)).toHaveLength(2);
        expect(workflow.match(/schema_probe_mode='basic'/g)).toHaveLength(2);
        expect(workflow.match(/schema_probe_mode='pre-migration'/g)).toHaveLength(2);
        // Once for each of: the dry-run probe, the candidate probe, and the
        // deploy-via-SSH step that also gates the zero-debt assertion.
        expect(workflow.match(/SCHEMA_DRIFT_MODE: \$\{\{ inputs\.expect_schema_drift == 'DRIFT' \}\}/g)).toHaveLength(3);
    });

    test('the zero-debt initialization assertion is scoped to the one-shot drift repair, not every deploy', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        // threshold_debt is a legacy field the migration deliberately preserves
        // on rerun rather than resetting — so it is legitimately allowed to be
        // nonzero outside the one-shot repair transition. Asserting it is zero
        // unconditionally would hard-fail every future deploy the day any row
        // carries a real value.
        const gateIndex = deployBlock.indexOf('if [ "$SCHEMA_DRIFT_MODE" = "true" ]; then');
        const debtCheckIndex = deployBlock.indexOf('SELECT COUNT(*) FROM public.subscriptions WHERE threshold_debt <> 0');
        const skippedIndex = deployBlock.indexOf("THRESHOLD_DEBT_INITIALIZATION=SKIPPED");

        expect(gateIndex).toBeGreaterThan(-1);
        expect(debtCheckIndex).toBeGreaterThan(gateIndex);
        expect(skippedIndex).toBeGreaterThan(-1);
        expect(deployBlock).toContain(
            'envs: GHCR_BACKEND,GHCR_FRONTEND,GHCR_GROWTH,GROWTH_BOOTSTRAP_DIGEST,BACKEND_TAG,FRONTEND_TAG,BACKEND_DIGEST,FRONTEND_DIGEST,DEPLOYED_COMMIT,WORKFLOW_RUN_ID,DEPLOYED_AT,GH_ACTOR,GH_TOKEN,WIPE_DB,SEED_ADMIN,ROLLBACK_STATE_DIR,SCHEMA_DRIFT_MODE',
        );
    });

    test('rejects the destructive production wipe path', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain('WIPE_DB=WIPE is disabled for production cutover');
        expect(deployBlock.indexOf('WIPE_DB=WIPE is disabled')).toBeLessThan(
            deployBlock.indexOf('if [ "$WIPE_DB" = "WIPE" ]; then', deployBlock.indexOf('WIPE_DB=WIPE is disabled') + 1),
        );
    });

    test('keeps repository-variable mutation outside contributor-controlled jobs', () => {
        expect(workflow).not.toContain('actions: write');
        expect(workflow).toContain('operator-owned repository control');
        expect(workflow).toContain("github.event.inputs.deploy_confirmation == format('DEPLOY-{0}', github.sha)");
        expect(workflow).toContain("description: 'One-shot production confirmation. Type DEPLOY-<full main SHA>.'");
    });

    test('requires an immutable image for restore-drill forward migration', () => {
        const backupWorkflow = fs.readFileSync(
            path.resolve(__dirname, '../../../../.github/workflows/backup.yml'),
            'utf8',
        );
        expect(backupWorkflow).toContain('forward migration image must be the immutable backend digest reference');
        expect(backupWorkflow).toContain('docker pull "$MIGRATION_IMAGE"');
    });

    test('rollback verifies restored images and health before returning', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain('verify_rollback() {');
        expect(deployBlock).toContain('rollback health check failed after 100s');
        expect(deployBlock).toContain('rollback || rc=70');
    });
});
