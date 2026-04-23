#!/usr/bin/env node

/**
 * Troubleshooting script for Meta Integration issues
 * Identifies where the connection flow is failing
 */

require('dotenv').config();
const crypto = require('crypto');

const {
  sequelize,
  MetaIntegration,
  Channel
} = (() => {
  try {
    const db = require('./src/utils/database/database-setup');
    return {
      sequelize: db.sequelize,
      MetaIntegration: require('./src/modules/integration/meta-integration.entity'),
      Channel: require('./src/modules/channel/channel.entity').default || 
               require('./src/modules/channel/channel.entity')
    };
  } catch (e) {
    console.error('Failed to load database:', e.message);
    process.exit(1);
  }
})();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

const log = {
  ok: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  err: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  section: (msg) => console.log(`\n${colors.blue}${'='.repeat(50)}${colors.reset}\n${colors.blue}${msg}${colors.reset}\n${colors.blue}${'='.repeat(50)}${colors.reset}\n`)
};

async function troubleshoot() {
  try {
    log.section('META INTEGRATION TROUBLESHOOTING');

    // 1. Check database connection
    log.info('Checking database connection...');
    try {
      await sequelize.authenticate();
      log.ok('Database connected');
    } catch (e) {
      log.err(`Database connection failed: ${e.message}`);
      process.exit(1);
    }

    // 2. Check table existence
    log.info('\nChecking database tables...');
    const tables = await sequelize.showAllSchemas();
    const hasMetaIntegrations = tables.some(t => 
      (t.tableName || t.name) === 'meta_integrations'
    );
    const hasChannels = tables.some(t => 
      (t.tableName || t.name) === 'channel_configs'
    );
    
    if (hasMetaIntegrations) {
      log.ok('meta_integrations table exists');
    } else {
      log.err('meta_integrations table missing - run migrations');
    }
    
    if (hasChannels) {
      log.ok('channel_configs table exists');
    } else {
      log.err('channel_configs table missing - run migrations');
    }

    // 3. Check environment variables
    log.info('\nChecking required environment variables...');
    const requiredEnvs = [
      'META_APP_ID',
      'META_APP_SECRET',
      'META_WEBHOOK_VERIFY_TOKEN',
      'META_WEBHOOK_APP_SECRET'
    ];
    
    let allEnvsPresent = true;
    requiredEnvs.forEach(env => {
      if (process.env[env]) {
        log.ok(`${env} is set`);
      } else {
        log.err(`${env} is NOT set`);
        allEnvsPresent = false;
      }
    });

    if (!allEnvsPresent) {
      log.warn('Some required environment variables are missing - OAuth will fail');
    }

    // 4. Check database records
    log.info('\nChecking database records...');
    try {
      const integrationCount = await MetaIntegration.count();
      const channelCount = await Channel.count();
      
      console.log(`  meta_integrations: ${integrationCount} rows`);
      console.log(`  channel_configs: ${channelCount} rows`);
      
      if (integrationCount === 0) {
        log.warn('No Meta integrations found - run OAuth connection flow');
      } else {
        const integrations = await MetaIntegration.findAll();
        integrations.forEach(i => {
          console.log(`    └─ ${i.platform} (${i.meta_asset_id}) - Status: ${i.status}`);
        });
      }
      
      if (channelCount === 0) {
        log.warn('No channels found - run OAuth connection flow');
      } else {
        const channels = await Channel.findAll();
        channels.forEach(c => {
          console.log(`    └─ ${c.channel_type} (${c.page_id}) - Active: ${c.is_active}`);
        });
      }
    } catch (e) {
      log.err(`Failed to query records: ${e.message}`);
    }

    // 5. Check webhook verification token
    log.info('\nChecking webhook configuration...');
    const webhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (webhookVerifyToken) {
      const tokenSample = webhookVerifyToken.substring(0, 8) + '...';
      log.ok(`Webhook verify token configured: ${tokenSample}`);
    } else {
      log.err('META_WEBHOOK_VERIFY_TOKEN not set - webhook verification will fail');
    }

    // 6. Recommendations
    log.section('NEXT STEPS');
    console.log(`
1. Verify environment variables are set correctly:
   - META_APP_ID
   - META_APP_SECRET
   - META_WEBHOOK_VERIFY_TOKEN
   - META_WEBHOOK_APP_SECRET
   - BASE_URL (should be accessible from Meta servers)

2. To reconnect a Facebook page:
   a) Go to backend settings → Connected Channels
   b) Click "Add Channel" → Facebook
   c) Authorize with your Meta app
   d) Select your page from the list
   e) Submit to save the connection

3. Verify the webhook is receiving messages:
   a) Go to Meta App Dashboard → Webhooks
   b) Check subscription status
   c) Test with a sample message

4. Check server logs:
   tail -f server.log | grep -i "meta\|webhook"

5. If still having issues, run:
   node src/scripts/seed-admin.js (to reset demo data)
    `);

    process.exit(0);
  } catch (error) {
    log.err(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

troubleshoot();
