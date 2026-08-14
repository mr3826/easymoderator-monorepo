'use strict';

const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(
    __dirname,
    '../../../../.github/workflows/ci-cd.yml',
);
const workflow = fs.readFileSync(workflowPath, 'utf8');

describe('production workflow branch safety', () => {
    test('build and deploy jobs are restricted to main', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        const deployBlock = workflow.match(/\n  deploy:\n([\s\S]*)$/)?.[1];

        expect(buildBlock).toContain("github.ref == 'refs/heads/main'");
        expect(deployBlock).toContain("if: github.ref == 'refs/heads/main'");
    });

    test('pull requests can run tests but cannot build deployable images', () => {
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];
        expect(buildBlock).toContain("github.event_name != 'pull_request'");
    });

    test('every branch validates both production Docker build contexts without publishing', () => {
        const validationBlock = workflow.match(
            /\n  docker-build-validation:\n([\s\S]*?)\n  # ── 3\./,
        )?.[1];
        const buildBlock = workflow.match(/\n  build:\n([\s\S]*?)\n  # ── 4\./)?.[1];

        expect(validationBlock).toContain('Docker build validation (no push)');
        expect(validationBlock).toContain('context: ./EasyMod-backend');
        expect(validationBlock).toContain('context: ./EasyMod-frontend');
        expect(validationBlock.match(/push: false/g)).toHaveLength(2);
        expect(validationBlock.match(/load: true/g)).toHaveLength(2);
        expect(buildBlock).toContain('docker-build-validation');
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
        const replacementIndex = deployBlock.indexOf(
            'up -d --no-build --remove-orphans',
        );

        expect(migrationIndex).toBeGreaterThan(-1);
        expect(replacementIndex).toBeGreaterThan(-1);
        expect(migrationIndex).toBeLessThan(replacementIndex);
    });
});
