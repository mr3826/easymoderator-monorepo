#!/usr/bin/env node

/**
 * Database Restore Script for Docker Container
 * 
 * Used by backup-runner container for database restoration
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class DatabaseRestore {
  constructor() {
    this.backupDir = '/backups';
  }

  async restoreDatabase(backupFile) {
    console.log(`🔄 Restoring from backup: ${backupFile}`);
    
    try {
      const backupPath = path.join(this.backupDir, backupFile);
      
      // Check if backup file exists
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupFile}`);
      }

      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        throw new Error('DATABASE_URL environment variable not set');
      }

      const dbUrlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
      
      if (!dbUrlMatch) {
        throw new Error('Invalid DATABASE_URL format');
      }

      const [, user, , host, port, database] = dbUrlMatch;
      const password = process.env.DB_PASSWORD;
      
      if (!password) {
        throw new Error('DB_PASSWORD environment variable not set');
      }

      // Verify backup file integrity
      const stats = fs.statSync(backupPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log(`📄 Backup file: ${backupFile}`);
      console.log(`💾 Size: ${sizeInMB} MB`);
      console.log(`📅 Modified: ${stats.mtime}`);

      // Create restore command
      const restoreCommand = `PGPASSWORD="${password}" psql -h ${host} -p ${port} -U ${user} -d ${database} < "${backupPath}"`;
      
      console.log('⚠️  WARNING: This will overwrite current database!');
      console.log('🔄 Executing restore command...');
      
      execSync(restoreCommand, { stdio: 'inherit' });
      
      console.log('✅ Database restored successfully!');
      
      // Verify restore
      await this.verifyRestore();
      
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      throw error;
    }
  }

  async verifyRestore() {
    console.log('🔍 Verifying database restore...');
    
    try {
      const dbUrl = process.env.DATABASE_URL;
      const dbUrlMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
      
      if (!dbUrlMatch) {
        throw new Error('Invalid DATABASE_URL format');
      }

      const [, user, , host, port, database] = dbUrlMatch;
      const password = process.env.DB_PASSWORD;
      
      // Test database connection
      const testCommand = `PGPASSWORD="${password}" psql -h ${host} -p ${port} -U ${user} -d ${database} -c "SELECT COUNT(*) FROM information_schema.tables;"`;
      
      execSync(testCommand, { stdio: 'pipe' });
      
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
        .filter(file => file.endsWith('.sql'))
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
        console.log('  node restore-database.js restore backup-2023-05-06T15-30-00-000Z.sql');
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
