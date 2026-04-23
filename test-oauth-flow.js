#!/usr/bin/env node

/**
 * Debug Meta OAuth connection flow
 * Simulates the OAuth steps to identify where the failure occurs
 */

require('dotenv').config();

const metaService = require('./src/modules/integration/meta.service');
const channelOAuthService = require('./src/modules/channel/channel.oauth.service');
const { sequelize } = require('./src/utils/database/database-setup');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m'
};

async function testOAuthFlow() {
  console.log('\n' + colors.yellow + '=== META OAUTH FLOW TEST ===' + colors.reset + '\n');

  try {
    // Step 1: Check OAuth URL building
    console.log('Step 1: Build OAuth URL');
    try {
      const url = metaService.buildOAuthUrl('test-state', 'facebook');
      console.log(colors.green + '✓' + colors.reset + ' OAuth URL built successfully');
      console.log(`  URL: ${url.substring(0, 100)}...`);
    } catch (e) {
      console.log(colors.red + '✗' + colors.reset + ` OAuth URL building failed: ${e.message}`);
      return;
    }

    // Step 2: Check token encryption
    console.log('\nStep 2: Token encryption');
    try {
      const testToken = 'test-access-token-abc123';
      const encrypted = metaService.encryptToken(testToken);
      const decrypted = metaService.decryptToken(encrypted);
      
      if (decrypted === testToken) {
        console.log(colors.green + '✓' + colors.reset + ' Token encryption/decryption works');
      } else {
        console.log(colors.red + '✗' + colors.reset + ' Token encryption failed - decrypted value mismatch');
        return;
      }
    } catch (e) {
      console.log(colors.red + '✗' + colors.reset + ` Token encryption error: ${e.message}`);
      return;
    }

    // Step 3: Check database writes
    console.log('\nStep 3: Database connection test');
    try {
      await sequelize.authenticate();
      console.log(colors.green + '✓' + colors.reset + ' Database connection working');
    } catch (e) {
      console.log(colors.red + '✗' + colors.reset + ` Database connection failed: ${e.message}`);
      return;
    }

    // Step 4: Check MetaIntegration entity
    console.log('\nStep 4: MetaIntegration table test');
    try {
      const MetaIntegration = require('./src/modules/integration/meta-integration.entity');
      const count = await sequelize.query('SELECT COUNT(*) as cnt FROM meta_integrations;');
      console.log(colors.green + '✓' + colors.reset + ` MetaIntegration table accessible (${count[0][0].cnt} records)`);
    } catch (e) {
      console.log(colors.red + '✗' + colors.reset + ` MetaIntegration table error: ${e.message}`);
      return;
    }

    // Step 5: Check Channel entity
    console.log('\nStep 5: Channel table test');
    try {
      const Channel = require('./src/modules/channel/channel.entity');
      const count = await sequelize.query('SELECT COUNT(*) as cnt FROM channel_configs;');
      console.log(colors.green + '✓' + colors.reset + ` Channel table accessible (${count[0][0].cnt} records)`);
    } catch (e) {
      console.log(colors.red + '✗' + colors.reset + ` Channel table error: ${e.message}`);
      return;
    }

    console.log('\n' + colors.green + '✓ All diagnostic checks passed!' + colors.reset);
    console.log(colors.yellow + '\nPossible issues:' + colors.reset);
    console.log('  1. Frontend OAuth redirect not configured correctly');
    console.log('  2. Backend /oauth/callback endpoint not receiving the auth code');
    console.log('  3. OAuth service methods not returning data properly');
    console.log('  4. Frontend not calling /channels/connect API after OAuth callback');
    console.log('\nTo debug further:');
    console.log('  - Check browser console for OAuth errors');
    console.log('  - Check server logs: tail -f server.log | grep -i oauth');
    console.log('  - Verify META_APP_ID is set: echo $process.env.META_APP_ID');

  } catch (error) {
    console.log(colors.red + '✗' + colors.reset + ` Unexpected error: ${error.message}`);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

testOAuthFlow();
