'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HARNESS_PATH = path.join(__dirname, 'worker-restart-harness.js');
const EXPECTED_PROJECT = 'easymod-operational-gate-closure-v1';

function runSetup({ projectName, projectConfirmation }) {
    const env = {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/easymod_ops_gate_e2e',
        OPS_E2E_SEED_CONFIRM: 'SEED_LOCAL_OPS_E2E_ONLY',
        CLOSURE_COMPOSE_PROJECT_NAME: projectName,
        ...(projectConfirmation ? { OPS_E2E_PROJECT_CONFIRM: projectConfirmation } : {}),
    };
    return spawnSync(process.execPath, [HARNESS_PATH, 'setup'], { encoding: 'utf8', env });
}

describe('worker restart harness project guard', () => {
    it('refuses setup when the actual Compose project name is different', () => {
        const result = runSetup({
            projectName: 'another-project',
            projectConfirmation: EXPECTED_PROJECT,
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Refusing rehearsal: CLOSURE_COMPOSE_PROJECT_NAME');
    });

    it('requires explicit confirmation of the closure Compose project', () => {
        const result = runSetup({ projectName: EXPECTED_PROJECT });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Refusing rehearsal without OPS_E2E_PROJECT_CONFIRM');
    });
});
