#!/usr/bin/env node
/**
 * One-time script: Subscribe test page to Meta webhooks
 * Requires: Channel record exists with access_token and page_id
 */

require('dotenv').config();
const { Channel } = require('./src/modules/entities');
const metaService = require('./src/modules/integration/meta.service');

async function subscribeTestPage() {
  try {
    // Find the test page channel
    const channel = await Channel.findOne({
      where: { page_id: '61585765555412' }
    });

    if (!channel) {
      console.error('❌ Channel with page_id 61585765555412 not found');
      process.exit(1);
    }

    console.log('📱 Found channel:', channel.id);
    console.log('🔐 Decrypting access token...');

    // Decrypt the stored token
    const accessToken = metaService.decryptToken(channel.access_token);

    // Determine platform from channel_type
    const platformMap = { messenger: 'facebook', instagram: 'instagram', whatsapp: 'whatsapp' };
    const platform = platformMap[channel.channel_type] || 'facebook';

    console.log('🔗 Creating MetaIntegration record...');
    await metaService.upsertIntegration(
      channel.shop_id,
      platform,
      channel.page_id,
      channel.settings?.display_name || 'Test Page',
      accessToken
    );
    console.log('✅ MetaIntegration created');

    console.log('🔔 Subscribing to Meta webhooks...');
    await metaService.subscribeToWebhooks(accessToken, channel.page_id, platform);
    console.log('✅ Webhook subscription successful');

    console.log('\n✨ Test page is now fully connected!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

subscribeTestPage();
