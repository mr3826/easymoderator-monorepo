#!/usr/bin/env node

/**
 * Database Restore Script for Docker Container
 * 
 * Used by backup-runner container for database restoration
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class DatabaseRestore {
  constructor() {
    this.backupDir = '/backups';
  }

  parseDatabaseUrl(dbUrl) {
    let parsed;
    try {
      parsed = new URL(dbUrl);
    } catch (_) {
      throw new Error('Invalid RECOVERY_DATABASE_URL format');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
      throw new Error('Invalid RECOVERY_DATABASE_URL format');
    }
    return {
      user: decodeURIComponent(parsed.username),
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeURIComponent(parsed.pathname.slice(1)),
    };
  }

  databaseArgs(user, host, port, database) {
    return ['-h', host, '-p', port, '-U', user, '-d', database];
  }

  runCustomRestore(backupPath, databaseArgs, password) {
    const result = spawnSync(
      'pg_restore',
      ['--clean', '--if-exists', '--exit-on-error', '--no-owner', '--no-privileges', ...databaseArgs, backupPath],
      { stdio: 'inherit', env: { ...process.env, PGPASSWORD: password } },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`pg_restore exited with status ${result.status}`);
  }

  runSqlRestore(backupPath, databaseArgs, password) {
    return new Promise((resolve, reject) => {
      const psql = spawn('psql', ['--set', 'ON_ERROR_STOP=1', ...databaseArgs], {
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, PGPASSWORD: password },
      });
      const source = backupPath.endsWith('.gz')
        ? spawn('gzip', ['-dc', backupPath], { stdio: ['ignore', 'pipe', 'inherit'] })
        : fs.createReadStream(backupPath);
      const sourceOutput = source.stdout || source;
      let sourceStatus = null;
      let psqlStatus = null;
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        if (psql.exitCode === null) psql.kill();
        if (source.kill && source.exitCode === null) source.kill();
        reject(error);
      };
      const finish = () => {
        if (settled || sourceStatus === null || psqlStatus === null) return;
        if (sourceStatus !== 0) return fail(new Error(`gzip exited with status ${sourceStatus}`));
        if (psqlStatus !== 0) return fail(new Error(`psql exited with status ${psqlStatus}`));
        settled = true;
        resolve();
      };

      sourceOutput.on('error', fail);
      source.on('error', fail);
      psql.on('error', fail);
      source.on('close', (code) => { sourceStatus = code ?? 0; finish(); });
      psql.on('close', (code) => { psqlStatus = code ?? 0; finish(); });
      sourceOutput.pipe(psql.stdin);
    });
  }

  async restoreDatabase(backupFile) {
    console.log(`🔄 Restoring from backup: ${backupFile}`);
    
    try {
      const backupRoot = path.resolve(this.backupDir);
      const backupPath = path.resolve(backupRoot, backupFile);
      if (!backupPath.startsWith(`${backupRoot}${path.sep}`)) {
        throw new Error('Backup file must remain inside the backup directory');
      }
      
      // Check if backup file exists
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupFile}`);
      }

      if (process.env.RECOVERY_TARGET !== 'isolated') {
        throw new Error('RECOVERY_TARGET=isolated is required; production restore is disabled');
      }

      const dbUrl = process.env.RECOVERY_DATABASE_URL;
      if (!dbUrl) {
        throw new Error('RECOVERY_DATABASE_URL environment variable not set');
      }

      const { user, host, port, database } = this.parseDatabaseUrl(dbUrl);
      const password = process.env.RECOVERY_DB_PASSWORD;
      
      if (!password) {
        throw new Error('RECOVERY_DB_PASSWORD environment variable not set');
      }

      // Verify backup file integrity
      const stats = fs.statSync(backupPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log(`📄 Backup file: ${backupFile}`);
      console.log(`💾 Size: ${sizeInMB} MB`);
      console.log(`📅 Modified: ${stats.mtime}`);

      console.log('ℹ️  Restoring only into the explicitly isolated recovery target.');
      console.log('🔄 Executing restore command...');

      const databaseArgs = this.databaseArgs(user, host, port, database);
      if (backupPath.endsWith('.dump')) {
        this.runCustomRestore(backupPath, databaseArgs, password);
      } else {
        await this.runSqlRestore(backupPath, databaseArgs, password);
      }
      
      console.log('✅ Database restored successfully!');
      
      // Verify restore
      await this.verifyRestore({ user, host, port, database }, password);
      
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      throw error;
    }
  }

  async verifyRestore(connection, password) {
    console.log('🔍 Verifying database restore...');
    
    try {
      const result = spawnSync('psql', [
        ...this.databaseArgs(connection.user, connection.host, connection.port, connection.database),
        '-v', 'ON_ERROR_STOP=1',
        '-c', 'SELECT COUNT(*) FROM information_schema.tables;',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PGPASSWORD: password },
        encoding: 'utf8',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`psql verification exited with status ${result.status}`);
      
      console.log('✅ Database restore verified successfully!');
      
    } catch (error) {
      console.error('❌ Restore verification failed:', error.message);
      throw error;
    }
  }

  listAvailableBackups() {
    console.log('📋 Available backups:');
    
    try {
      if (!fs.existsSync(this.backupDir)) {
        console.log('   No backup directory found');
        return [];
      }

      const files = fs.readdirSync(this.backupDir)
        .filter(file => file.endsWith('.sql') || file.endsWith('.dump') || file.endsWith('.sql.gz'))
        .map(file => {
          const filePath = path.join(this.backupDir, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            path: filePath,
            size: stats.size,
            created: stats.mtime,
            sizeInMB: (stats.size / (1024 * 1024)).toFixed(2)
          };
        })
        .sort((a, b) => b.created - a.created);

      if (files.length === 0) {
        console.log('   No backup files found');
        return files;
      }

      files.forEach((backup, index) => {
        console.log(`   ${index + 1}. ${backup.filename} (${backup.sizeInMB} MB) - ${backup.created.toLocaleString()}`);
      });

      return files;
      
    } catch (error) {
      console.error('❌ Failed to list backups:', error.message);
      return [];
    }
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const restore = new DatabaseRestore();

  try {
    switch (command) {
      case 'restore':
        const backupFile = process.argv[3];
        if (!backupFile) {
          console.error('❌ Please specify backup file to restore');
          console.log('Usage: node restore-database.js restore <backup-file>');
          process.exit(1);
        }
        await restore.restoreDatabase(backupFile);
        break;
        
      case 'list':
        await restore.listAvailableBackups();
        break;
        
      default:
        console.log('🔄 Database Restore Tool\n');
        console.log('\nUsage:');
        console.log('  node restore-database.js <command>');
        console.log('\nCommands:');
        console.log('  restore   - Restore from backup file');
        console.log('  list      - List available backups');
        console.log('\nExamples:');
        console.log('  node restore-database.js restore backup-2023-05-06T15-30-00-000Z.dump');
        console.log('  node restore-database.js list');
        break;
    }
  } catch (error) {
    console.error('❌ Operation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = DatabaseRestore;
