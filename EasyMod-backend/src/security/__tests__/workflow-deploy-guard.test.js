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
});
