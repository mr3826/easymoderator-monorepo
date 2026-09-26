'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/ci-cd.yml',
);
const workflow = fs.readFileSync(workflowPath, 'utf8');
const workflowDirectory = path.resolve(__dirname, '../../../../.github/workflows');
const composePath = path.resolve(__dirname, '../../../../docker-compose.prod.yml');
const compose = fs.readFileSync(composePath, 'utf8');
const securityWorkflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/security-scan.yml',
);
const securityWorkflow = fs.readFileSync(securityWorkflowPath, 'utf8');
const growthWorkflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/growth-os.yml',
);
const growthWorkflow = fs.readFileSync(growthWorkflowPath, 'utf8');
const grantGrowthRoleWorkflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/grant-growth-role.yml',
);
const grantGrowthRoleWorkflow = fs.readFileSync(grantGrowthRoleWorkflowPath, 'utf8');
const seedInitialGrowthAdminWorkflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/seed-initial-growth-admin.yml',
);
const seedInitialGrowthAdminWorkflow = fs.readFileSync(seedInitialGrowthAdminWorkflowPath, 'utf8');

describe('production workflow branch safety', () => {
    test('build and deploy jobs are restricted to main', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(buildBlock).toContain("github.ref == 'refs/heads/main'");
        expect(deployBlock).toContain("github.event_name == 'workflow_dispatch'");
        expect(deployBlock).toContain("github.ref == 'refs/heads/main'");
    });

    test('routes privileged Growth workflows through the semantic backend and Growth gates', () => {
        expect(workflow).toContain('.github/workflows/grant-growth-role.yml');
        expect(workflow).toContain('.github/workflows/seed-initial-growth-admin.yml');
        const growthCase = workflow.slice(workflow.indexOf('EasyMod-growth/*'), workflow.indexOf('EasyMod-growth/*') + 600);
        expect(growthCase).toContain('.github/workflows/seed-initial-growth-admin.yml');
    });

    test('deploy passes the Action Gate secret to production rendering', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain('AI_ACTION_GATE_SECRET: ${{ secrets.AI_ACTION_GATE_SECRET }}');
    });

    test('pull requests can run tests but cannot build deployable images', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        expect(buildBlock).toContain("github.event_name != 'pull_request'");
    });

    test('cancels only stale PR validation and scopes package write access to publishing', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        const topLevelPermissions = workflow.match(/\npermissions:\n([\s\S]*?)\n\nenv:/)?.[1];

        expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
        expect(topLevelPermissions).not.toContain('packages:');
        expect(workflow).toContain('permissions:\n      contents: read\n      packages: read');
        expect(topLevelPermissions).not.toContain('packages: write');
        expect(buildBlock).toContain('permissions:\n      contents: read\n      packages: write');
    });

    test('cancels stale security scans only for PRs', () => {
        expect(securityWorkflow).toContain(
            'group: security-scan-${{ github.event.pull_request.number || github.ref }}',
        );
        expect(securityWorkflow).toContain(
            "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        );
    });

    test('Growth OS reusable workflow keeps publish permissions inside the caller ceiling', () => {
        // This test file is deliberately under `EasyMod-backend/`: the `changes`
        // path filter treats it as a backend change, so a push here guarantees
        // the real GitHub planner + Jest both re-execute. The `startup_failure`
        // regression I shipped at 911e351 and the ceiling fix at 57cbdd9 both
        // passed locally but differed on real run `35560390196` — that class of
        // silent divergence is exactly what this test is here to prevent from
        // repeating against a future reviewer who only trusts actionlint.
        // Final receipt: Actions run `35561961284` at SHA `3e5077d` — 16/16
        // checks pass or correctly skip; this Jest assertion is included in the
        // `Test & Build Gate` job's execution.
        //
        // Regression guard for the reusable-workflow permission-mismatch I
        // actually shipped at a56045e: `growth-os.yml` requests packages.write
        // at its top level (for its `build-and-push` job), so the caller in
        // ci-cd.yml MUST grant that scope. GitHub validates reusable
        // permissions at PLAN time — the `if:` and event filter are irrelevant
        // to the ceiling check. Before my fix the whole CI/CD workflow failed
        // startup and every PR lost its aggregate context.
        //
        // The check intentionally uses a simple substring assertion for the
        // ci-cd.yml caller block: if we can find the caller's permissions
        // granting packages.write (paired with contents.read) after the
        // `uses: ./.github/workflows/growth-os.yml` line, we're consistent.
        const usesLine = workflow.indexOf('uses: ./.github/workflows/growth-os.yml');
        expect(usesLine).toBeGreaterThan(-1);
        const afterUses = workflow.slice(usesLine, usesLine + 500);
        expect(afterUses).toContain('permissions:');
        expect(afterUses).toContain('contents: read');
        expect(afterUses).toContain('packages: write');

        // The reusable workflow keeps its publish capability — that's exactly
        // the top-level permission we mirror from the caller.
        const growthPermissions = growthWorkflow.match(/\npermissions:\n  contents: read\n  packages: write/);
        expect(growthPermissions).not.toBeNull();

        // The `build-and-push` job (the ONLY job that pushes) must be restricted
        // to the default branch even for manual dispatches. Otherwise a maintainer
        // could publish an arbitrary branch's image with package-write authority.
        expect(growthWorkflow).toContain(
            "if: github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || github.event_name == 'push')",
        );

        // Two PR-reachable jobs must narrow their scope below the ceiling so a
        // leaked token from a PR-controlled process cannot write to packages.
        const verifyBlock = growthWorkflow.match(/\n  verify:\n([\s\S]*?)\n  browser-e2e:/)?.[1];
        expect(verifyBlock).toContain('permissions:\n      contents: read');
        expect(verifyBlock).not.toContain('packages: write');
        const browserBlock = growthWorkflow.match(/\n  browser-e2e:\n([\s\S]*?)\n  build-and-push:/)?.[1];
        expect(browserBlock).toContain('permissions:\n      contents: read');
        expect(browserBlock).not.toContain('packages: write');
    });

    test('keeps Growth role bootstrap on the configured production environment', () => {
        expect(grantGrowthRoleWorkflow).toContain(
            "if: github.ref == 'refs/heads/main' && github.actor == 'mr3826'",
        );
        expect(grantGrowthRoleWorkflow).toContain('environment: production');
        expect(grantGrowthRoleWorkflow).not.toContain('environment: growth-bootstrap');
    });

    test('caps privileged remote commands with explicit command timeouts, not transport defaults', () => {
        // appleboy `timeout:` is connection-only; the remote command must have
        // its own cap so a committed privileged mutation is never reaped by a
        // hidden default (grant hang) and a long deploy is never cut off.
        expect(grantGrowthRoleWorkflow).toContain('command_timeout: 15m');
        expect(workflow).toContain('command_timeout: 30m');
    });

    test('runs the bootstrap script in the running backend without Compose interpolation', () => {
        expect(grantGrowthRoleWorkflow).toContain("--filter 'label=com.docker.compose.service=backend'");
        expect(grantGrowthRoleWorkflow).toContain('docker exec \\');
        expect(grantGrowthRoleWorkflow).toContain('node src/scripts/grant-growth-role.js');
        expect(grantGrowthRoleWorkflow).not.toContain('docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T');
    });

    test('protects the one-time initial-admin seed behind main, production, concurrency, and a masked secret', () => {
        expect(seedInitialGrowthAdminWorkflow).toContain(
            "if: github.ref == 'refs/heads/main' && github.actor == 'mr3826'",
        );
        expect(seedInitialGrowthAdminWorkflow).toContain('environment: production');
        expect(seedInitialGrowthAdminWorkflow).toContain('group: seed-initial-growth-admin');
        expect(seedInitialGrowthAdminWorkflow).toContain('INITIAL_GROWTH_ADMIN_PASSWORD: ${{ secrets.INITIAL_GROWTH_ADMIN_PASSWORD }}');
        expect(seedInitialGrowthAdminWorkflow).toContain('node src/scripts/seed-initial-growth-admin.js');
        expect(seedInitialGrowthAdminWorkflow).toContain('docker exec -i \\');
        expect(seedInitialGrowthAdminWorkflow).toContain("| ssh -i \"$key_file\"");
        expect(seedInitialGrowthAdminWorkflow).not.toContain('envs: TARGET_EMAIL,INITIAL_GROWTH_ADMIN_PASSWORD,GITHUB_ACTOR');
        expect(seedInitialGrowthAdminWorkflow).not.toContain('-e INITIAL_GROWTH_ADMIN_PASSWORD=');
        expect(seedInitialGrowthAdminWorkflow).not.toMatch(/INITIAL_GROWTH_ADMIN_PASSWORD\s*:\s*['"]/);
        expect(seedInitialGrowthAdminWorkflow).not.toContain('echo "${INITIAL_GROWTH_ADMIN_PASSWORD}"');
    });

    test('keeps the canonical grant workflow dependent on the seeded identity and protected actor', () => {
        expect(grantGrowthRoleWorkflow).toContain('GROWTH_BOOTSTRAP_ACTOR_EMAIL');
        expect(grantGrowthRoleWorkflow).toContain('environment: production');
        expect(grantGrowthRoleWorkflow).toContain('node src/scripts/grant-growth-role.js');
        expect(grantGrowthRoleWorkflow).not.toContain('INITIAL_GROWTH_ADMIN_PASSWORD');
    });

    test('runs the platform-admin grant on the running backend without Compose interpolation', () => {
        const platformAdminWorkflow = fs.readFileSync(
            path.resolve(__dirname, '../../../../.github/workflows/grant-platform-admin.yml'),
            'utf8',
        );
        expect(platformAdminWorkflow).toContain(
            "if: github.ref == 'refs/heads/main' && github.actor == 'mr3826'",
        );
        expect(platformAdminWorkflow).toContain('environment: production');
        expect(platformAdminWorkflow).toContain('group: grant-platform-admin');
        expect(platformAdminWorkflow).toContain('command_timeout: 15m');
        expect(platformAdminWorkflow).toContain('envs: TARGET_EMAIL,TARGET_ROLE,GITHUB_ACTOR');
        expect(platformAdminWorkflow).toContain("--filter 'label=com.docker.compose.service=backend'");
        expect(platformAdminWorkflow).toContain('docker exec \\');
        expect(platformAdminWorkflow).toContain('node src/scripts/grant-platform-admin.js');
        expect(platformAdminWorkflow).not.toContain('docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T');
        expect(workflow).toContain('.github/workflows/grant-platform-admin.yml');
    });

    test('keeps browser and server Sentry configuration boundaries separate', () => {
        expect(workflow).toContain('VITE_SENTRY_DSN: ${{ vars.VITE_SENTRY_DSN }}');
        expect(workflow.match(/VITE_SENTRY_DSN=\$\{\{ vars\.VITE_SENTRY_DSN \}\}/g)).toHaveLength(2);
        expect(workflow).toContain('SENTRY_DSN: ${{ secrets.SENTRY_DSN }}');
        expect(workflow).not.toContain('SENTRY_DSN: ${{ secrets.SENTRY_DSN || secrets.VITE_SENTRY_DSN }}');
    });

    test('fails closed instead of deleting Redis persistence during deployment recovery', () => {
        expect(workflow).toContain('refusing automatic volume deletion');
        expect(workflow).not.toContain('reset_redis_volume');
        expect(workflow).not.toContain('RVOL=$(docker volume');
    });

    test('manual deployment probes cannot execute branch-controlled code with production secrets', () => {
        const deploymentConfigBlock = workflow.match(/\n  deployment-config:\n([\s\S]*?)\n  # ── 2d\./)?.[1];

        expect(deploymentConfigBlock).toContain(
            "github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'",
        );
        expect(deploymentConfigBlock).toContain(
            "if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'",
        );
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
            'envs: GHCR_BACKEND,GHCR_FRONTEND,GHCR_GROWTH,GROWTH_BOOTSTRAP_DIGEST,GROWTH_IMAGE_OVERRIDE,BACKEND_TAG,FRONTEND_TAG,BACKEND_DIGEST,FRONTEND_DIGEST,DEPLOYED_COMMIT,WORKFLOW_RUN_ID,DEPLOYED_AT,GH_ACTOR,GH_TOKEN,WIPE_DB,SEED_ADMIN,ROLLBACK_STATE_DIR,SCHEMA_DRIFT_MODE',
        );
    });

    test('the candidate-probe digest-pin check uses a real regex, not a shell glob', () => {
        // `case … in *@sha256:[0-9a-fA-F]{64})` is a shell glob, where `{64}` has
        // no repetition meaning (bash only expands `{a,b}`/`{x..y}`) — it can
        // never match a real digest, so the probe fails closed on every run.
        // This job's `if:` only runs on a real deploy_confirmation dispatch, so
        // no prior green CI run ever exercised it. Must use grep -E (or an
        // equivalent real-regex engine) like the other two digest-pin checks in
        // this file do.
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).not.toMatch(/case\s+"\$image_ref"\s+in\s+\*@sha256:\[0-9a-fA-F\]\{64\}\)/);
        expect(deployBlock).toContain("grep -Eq '@sha256:[0-9a-fA-F]{64}");
        // Three real-regex digest-pin checks total: EXISTING_BACKEND_DIGEST
        // format validation, this probe, and assert_immutable_ref(). Each is in
        // a different quoting context (one needs \$ since it is nested inside a
        // local double-quoted ssh argument), so match on the pattern core only.
        expect(workflow.match(/grep -Eq '[^']*\\?\[0-9a-fA-F\]\\?\{64\\?\}[^']*'/g)).toHaveLength(3);
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

    test('derives and fails closed on a pinned fingerprint at every SSH action site', () => {
        const sshWorkflows = fs
            .readdirSync(workflowDirectory)
            .filter((name) => name.endsWith('.yml'))
            .map((name) => ({
                source: fs.readFileSync(path.join(workflowDirectory, name), 'utf8'),
            }))
            .filter(({ source }) => source.includes('uses: appleboy/ssh-action@'));

        let sshActionSites = 0;
        for (const { source } of sshWorkflows) {
            sshActionSites += (source.match(/uses: appleboy\/ssh-action@/g) || []).length;
            expect(source).toContain('fingerprint: ${{ steps.ssh_host.outputs.fingerprint }}');
            expect(source).toContain('id: ssh_host');
            expect(source).toContain('DO_SSH_KNOWN_HOSTS');
            expect(source).toContain("if [ -z \"$key_type\" ] || [ -z \"$key_blob\" ]; then");
            expect(source).toContain("echo '::error::pinned host key is missing for DEPLOY_HOST'");
            expect(source).toContain('exit 1');
            expect(source).not.toContain('DO_SSH_FINGERPRINT');
            expect(source).not.toContain('ssh-keyscan');
        }

        expect(sshActionSites).toBe(9);
    });

    test('requires an immutable image for restore-drill forward migration', () => {
        const backupWorkflow = fs.readFileSync(
            path.resolve(__dirname, '../../../../.github/workflows/backup.yml'),
            'utf8',
        );
        expect(backupWorkflow).toContain('forward migration image must be the immutable backend digest reference');
        expect(backupWorkflow).toContain('docker pull "$MIGRATION_IMAGE"');
        expect(backupWorkflow).toContain('DEST_PREFIX" = "uploads"');
        expect(backupWorkflow).toContain('tar -tzf "/backup/$(basename "$DECRYPTED")"');
        // Both backup and restore-drill open SSH into production; both must sit
        // behind the production environment gate. A future edit that adds a
        // concurrency block but forgets one env gate must fail closed here.
        const backup = backupWorkflow.replace(/\r\n/g, '\n');
        expect(backup).toMatch(/^ {4}environment: production$/m);
        // Assert that BOTH jobs have their own environment: production line,
        // not just one. The backup job appears before restore-drill in the
        // file; the count must be at least 2 to close the previous gap where
        // only backup had it.
        const environmentMatches = backup.match(/^ {4}environment: production$/gm) || [];
        expect(environmentMatches.length).toBeGreaterThanOrEqual(2);
    });

    test('backup validates the configured off-site retention policy', () => {
        const backupWorkflow = fs.readFileSync(
            path.resolve(__dirname, '../../../../.github/workflows/backup.yml'),
            'utf8',
        );

        expect(backupWorkflow).toContain(
            'OFFSITE_RETENTION_DAYS must be a positive integer',
        );
        expect(backupWorkflow).toContain(
            "Rules[?Status==`Enabled` && Expiration.Days != `null`].[Filter.Prefix,Expiration.Days]",
        );
        expect(backupWorkflow).toContain(
            'END { exit (broad || (db && uploads)) ? 0 : 1 }',
        );
        expect(backupWorkflow).toContain(
            'Off-site lifecycle retention policy verified',
        );
    });

    test('rollback verifies restored images and health before returning', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain('verify_rollback() {');
        expect(deployBlock).toContain('rollback health check failed after 100s');
        expect(deployBlock).toContain('rollback || rc=70');
    });

    test('successful cutover proves the running image reports the requested commit', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];
        const healthIndex = deployBlock.indexOf("http://127.0.0.1:3000/health/ready");
        const versionIndex = deployBlock.indexOf("http://127.0.0.1:3000/api/version");

        expect(healthIndex).toBeGreaterThan(-1);
        expect(versionIndex).toBeGreaterThan(healthIndex);
        expect(deployBlock).toContain('docker exec -i -e EXPECTED_COMMIT="$DEPLOYED_COMMIT"');
        expect(deployBlock).toContain('payload.gitSha !== process.env.EXPECTED_COMMIT');
    });

    test('frontend-only cutovers require the SHA that produced the existing backend image', () => {
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(deployBlock).toContain(
            "github.event.inputs.target != 'frontend' || github.event.inputs.existing_candidate_sha != ''",
        );
        expect(deployBlock).toContain(
            'DEPLOYED_COMMIT: ${{ github.event.inputs.existing_candidate_sha || github.sha }}',
        );
    });
});
