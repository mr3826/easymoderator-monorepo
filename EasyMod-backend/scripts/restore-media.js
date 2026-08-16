#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class MediaRestore {
  constructor({ backupDir = process.env.BACKUP_DIR || '/backups' } = {}) {
    this.backupDir = path.resolve(backupDir);
  }

  archivePath(archiveFile) {
    const archivePath = path.resolve(this.backupDir, archiveFile);
    if (!archivePath.startsWith(`${this.backupDir}${path.sep}`) || !fs.existsSync(archivePath)) {
      throw new Error('Media archive must exist inside the backup directory');
    }
    return archivePath;
  }

  assertIsolatedTarget() {
    if (process.env.RECOVERY_TARGET !== 'isolated') {
      throw new Error('RECOVERY_TARGET=isolated is required; production media restore is disabled');
    }
    if (!process.env.RECOVERY_MEDIA_DIR) {
      throw new Error('RECOVERY_MEDIA_DIR environment variable not set');
    }
    return path.resolve(process.env.RECOVERY_MEDIA_DIR);
  }

  listEntries(archivePath) {
    const result = spawnSync('tar', ['-tzf', archivePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tar listing exited with status ${result.status}`);
    return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  }

  assertNoLinks(archivePath, entries) {
    const result = spawnSync('tar', ['-tvzf', archivePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tar verbose listing exited with status ${result.status}`);
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length !== entries.length) throw new Error('Media archive listing could not be correlated safely');
    if (lines.some((line) => /^[lh]/.test(line))) {
      throw new Error('Media archive contains a symbolic or hard link');
    }
  }

  assertSafeEntries(entries) {
    for (const entry of entries) {
      const normalized = entry.replace(/\\/g, '/');
      if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error('Media archive contains an unsafe path');
      }
    }
  }

  restore(archiveFile) {
    const target = this.assertIsolatedTarget();
    const archivePath = this.archivePath(archiveFile);
    const entries = this.listEntries(archivePath);
    this.assertSafeEntries(entries);
    this.assertNoLinks(archivePath, entries);
    fs.mkdirSync(target, { recursive: true });
    const result = spawnSync('tar', [
      '-xzf', archivePath,
      '-C', target,
      '--no-same-owner',
      '--no-same-permissions',
    ], {
      stdio: 'inherit',
      windowsHide: true,
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`tar extraction exited with status ${result.status}`);
    return { status: 'PASS', target, entryCount: entries.length };
  }

  verify(relativeFile, expectedSha256 = null) {
    const target = this.assertIsolatedTarget();
    const filePath = path.resolve(target, relativeFile);
    if (!filePath.startsWith(`${target}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new Error('Representative media file is missing from the isolated target');
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (expectedSha256 && hash !== expectedSha256.toLowerCase()) {
      throw new Error('Representative media SHA256 mismatch');
    }
    return { status: 'PASS', relativeFile, sha256: hash };
  }
}

async function main() {
  const command = process.argv[2];
  const tool = new MediaRestore();
  try {
    if (command === 'restore') {
      if (!process.argv[3]) throw new Error('Usage: restore-media.js restore <archive>');
      console.log(JSON.stringify(tool.restore(process.argv[3])));
    } else if (command === 'verify') {
      if (!process.argv[3]) throw new Error('Usage: restore-media.js verify <relative-file> [sha256]');
      console.log(JSON.stringify(tool.verify(process.argv[3], process.argv[4] || null)));
    } else {
      throw new Error('Usage: restore-media.js <restore|verify> ...');
    }
  } catch (error) {
    console.error(`Media restore failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = MediaRestore;
