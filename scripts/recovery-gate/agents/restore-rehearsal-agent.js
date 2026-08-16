'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { recoveryTargetIsExplicitlyIsolated } = require('../lib/secrets');

function checkNodeSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  return result.status === 0
    ? { status: 'PASS' }
    : { status: 'FAIL', error: 'NODE_SYNTAX_CHECK_FAILED' };
}

function checkDocker() {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error?.code === 'ENOENT') return { status: 'MISSING' };
  if (result.status !== 0) return { status: 'UNAVAILABLE' };
  return { status: 'PASS' };
}

function run({ repoRoot, env = process.env, probeDocker = true, executeRestore = false } = {}) {
  const restorePath = path.join(repoRoot, 'EasyMod-backend', 'scripts', 'restore-database.js');
  const mediaRestorePath = path.join(repoRoot, 'EasyMod-backend', 'scripts', 'restore-media.js');
  const restoreText = fs.existsSync(restorePath) ? fs.readFileSync(restorePath, 'utf8') : '';
  const syntax = fs.existsSync(restorePath) ? checkNodeSyntax(restorePath) : { status: 'NOT_FOUND_IN_CODEBASE' };
  const undefinedExecSync = /\bexecSync\b/.test(restoreText) && !/execSync.*require|\{[^}]*execSync[^}]*\}/s.test(restoreText);
  const isolated = recoveryTargetIsExplicitlyIsolated(env);
  const docker = probeDocker ? checkDocker() : { status: 'NOT_EXECUTED' };

  let rehearsal = { status: 'NOT_MEASURED', reason: 'No isolated recovery target/archive was supplied.' };
  if (executeRestore && !isolated) {
    rehearsal = {
      status: 'BLOCKED',
      blocker: 'ISOLATED_RECOVERY_TARGET_REQUIRED',
      message: 'Set RECOVERY_TARGET=isolated, RECOVERY_DATABASE_URL, and RECOVERY_DB_PASSWORD; never use DATABASE_URL.',
    };
  }
  if (executeRestore && isolated) {
    rehearsal = {
      status: 'BLOCKED_INPUT',
      blocker: env.RECOVERY_BACKUP_ARCHIVE ? 'RESTORE_EXECUTOR_NOT_ENABLED_BY_DEFAULT' : 'RECOVERY_BACKUP_ARCHIVE_MISSING',
    };
  }

  return {
    agent: 'Restore-Rehearsal Agent',
    tooling: {
      restoreScript: fs.existsSync(restorePath) ? 'FOUND' : 'NOT_FOUND_IN_CODEBASE',
      mediaRestoreScript: fs.existsSync(mediaRestorePath) ? 'FOUND' : 'NOT_FOUND_IN_CODEBASE',
      syntax,
      undefinedExecSync: undefinedExecSync ? 'FAIL' : 'PASS',
      restoreTargetPolicy: 'ISOLATED_ONLY',
      docker,
    },
    rehearsal,
    observedRpo: { db: 'NOT_MEASURED', media: 'NOT_MEASURED', observed: 'NOT_MEASURED' },
    observedRto: 'NOT_MEASURED',
  };
}

module.exports = { checkNodeSyntax, run };
