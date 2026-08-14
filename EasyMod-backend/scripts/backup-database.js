#!/usr/bin/env node

/**
 * Database Backup Automation Script
 * 
 * Provides automated database backups with point-in-time recovery
 * Supports local and cloud storage options
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class DatabaseBackup {
  constructor() {
    this.backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.ensureBackupDirectory();
  }

  ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      console.log('📁 Created backup directory:', this.backupDir);
    }
  }

  parseDatabaseUrl(dbUrl, errorName = 'DATABASE_URL') {
    let parsed;
    try {
      parsed = new URL(dbUrl);
    } catch (_) {
      throw new Error(`Invalid ${errorName} format`);
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
      throw new Error(`Invalid ${errorName} format`);
    }
    return {
      user: decodeURIComponent(parsed.username),
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeURIComponent(parsed.pathname.slice(1)),
      password: decodeURIComponent(parsed.password || ''),
    };
  }

  async createBackup() {
    console.log('🗄️ Starting database backup...');
    
    try {
      const backupFile = path.join(this.backupDir, `backup-${this.timestamp}.dump`);
      
      // Extract database connection info
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable not set');
      }

      const connection = this.parseDatabaseUrl(dbUrl);
      const password = process.env.DB_PASSWORD || connection.password;
      if (!password) throw new Error('DB_PASSWORD environment variable not set');

      console.log('📦 Executing backup command...');
      const output = fs.openSync(backupFile, 'w');
      try {
        const result = spawnSync('pg_dump', [
          '-h', connection.host,
          '-p', connection.port,
          '-U', connection.user,
          '-d', connection.database,
          '--no-password',
          '--clean',
          '--if-exists',
          '--format=custom',
          '--compress=9',
        ], {
          stdio: ['ignore', output, 'inherit'],
          env: { ...process.env, PGPASSWORD: password },
          windowsHide: true,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`pg_dump exited with status ${result.status}`);
      } finally {
        fs.closeSync(output);
      }
      
      // Verify backup was created
      const stats = fs.statSync(backupFile);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log('✅ Backup completed successfully!');
      console.log(`📄 File: ${path.basename(backupFile)}`);
      console.log(`💾 Size: ${sizeInMB} MB`);
      console.log(`📍 Location: ${backupFile}`);

      // Create backup metadata
      await this.createBackupMetadata(backupFile, stats.size);
      
      // Cleanup old backups (keep last 7 days)
      await this.cleanupOldBackups();
      
      return {
        success: true,
        file: backupFile,
        size: stats.size,
        timestamp: this.timestamp
      };

    } catch (error) {
      console.error('❌ Backup failed:', error.message);
      
      // Send notification on failure (if configured)
      await this.notifyBackupFailure(error);
      
      throw error;
    }
  }

  async createBackupMetadata(backupFile, size) {
    const metadata = {
      timestamp: this.timestamp,
      filename: path.basename(backupFile),
      size: size,
      environment: process.env.NODE_ENV || 'development',
      database: this.extractDatabaseName(),
      created: new Date().toISOString()
    };

    const metadataFile = backupFile.replace(/\.(?:sql|dump)$/, '.meta.json');
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    
    console.log('📋 Backup metadata created');
  }

  async cleanupOldBackups() {
    console.log('🧹 Cleaning up old backups...');
    
    const files = fs.readdirSync(this.backupDir);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(this.backupDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < sevenDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted old backup: ${file}`);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} old backup files`);
    }
  }

  extractDatabaseName() {
    const dbUrl = process.env.DATABASE_URL;
    try {
      return this.parseDatabaseUrl(dbUrl).database;
    } catch (_) {
      return 'unknown';
    }
  }

  async notifyBackupFailure(error) {
    // Simple console notification - can be extended to send emails, Slack, etc.
    console.log('🚨 BACKUP FAILURE NOTIFICATION:');
    console.log(`   Error: ${error.message}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Could integrate with notification service here
    // await notificationService.sendAlert('Database backup failed', error.message);
  }

  async listBackups() {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir)
      .filter(file => file.endsWith('.dump') || file.endsWith('.sql'))
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

    return files;
  }

  async restoreBackup(backupFile) {
    console.log(`🔄 Restoring from backup: ${backupFile}`);
    
    try {
      if (process.env.RECOVERY_TARGET !== 'isolated') {
        throw new Error('RECOVERY_TARGET=isolated is required; production restore is disabled');
      }
      const dbUrl = process.env.RECOVERY_DATABASE_URL;
      if (!dbUrl) throw new Error('RECOVERY_DATABASE_URL environment variable not set');
      const connection = this.parseDatabaseUrl(dbUrl, 'RECOVERY_DATABASE_URL');
      const password = process.env.RECOVERY_DB_PASSWORD;
      if (!password) throw new Error('RECOVERY_DB_PASSWORD environment variable not set');
      const backupRoot = path.resolve(this.backupDir);
      const backupPath = path.resolve(backupRoot, backupFile);
      if (!backupPath.startsWith(`${backupRoot}${path.sep}`) || !fs.existsSync(backupPath)) {
        throw new Error('Backup file must exist inside the backup directory');
      }

      // The backup is PostgreSQL custom format; restore it with pg_restore.
      // psql cannot consume a custom-format archive even when the file is
      // named with a SQL-like extension.
      const result = spawnSync('pg_restore', [
        '--clean', '--if-exists', '--no-owner', '--no-privileges',
        '-h', connection.host, '-p', connection.port, '-U', connection.user,
        '-d', connection.database, backupPath,
      ], {
        stdio: 'inherit',
        env: { ...process.env, PGPASSWORD: password },
        windowsHide: true,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`pg_restore exited with status ${result.status}`);

      console.log('ℹ️  Restore completed only against the explicitly isolated recovery target.');
      console.log('🔄 Executing restore command...');
      console.log('✅ Database restored successfully!');
      
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const backup = new DatabaseBackup();

  try {
    switch (command) {
      case 'create':
        await backup.createBackup();
        break;
        
      case 'list':
        const backups = await backup.listBackups();
        console.log('\n📦 Available Backups:');
        if (backups.length === 0) {
          console.log('   No backups found');
        } else {
          backups.forEach((backup, index) => {
            console.log(`   ${index + 1}. ${backup.filename} (${backup.sizeInMB} MB) - ${backup.created.toLocaleString()}`);
          });
        }
        break;
        
      case 'restore':
        const backupFile = process.argv[3];
        if (!backupFile) {
          console.error('❌ Please specify backup file to restore');
          console.log('Usage: node backup-database.js restore <backup-file>');
          process.exit(1);
        }
        await backup.restoreBackup(backupFile);
        break;
        
      default:
        console.log('🗄️ EasyMod Database Backup Tool\n');
        console.log('\nUsage:');
        console.log('  node backup-database.js <command>');
        console.log('\nCommands:');
        console.log('  create    - Create a new database backup');
        console.log('  list      - List available backups');
        console.log('  restore   - Restore from backup file');
        console.log('\nExamples:');
        console.log('  node backup-database.js create');
        console.log('  node backup-database.js list');
        console.log('  node backup-database.js restore backup-2023-05-06T15-30-00-000Z.dump');
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

module.exports = DatabaseBackup;
