require('dotenv').config();
const { sequelize } = require('./src/utils/database/database-setup');

async function check() {
  try {
    const [miRows] = await sequelize.query('SELECT COUNT(*) as count FROM meta_integrations;');
    const [ccRows] = await sequelize.query('SELECT COUNT(*) as count FROM channel_configs;');
    const [shopRows] = await sequelize.query('SELECT COUNT(*) as count FROM shops;');
    
    console.log(`meta_integrations: ${miRows[0].count} rows`);
    console.log(`channel_configs: ${ccRows[0].count} rows`);
    console.log(`shops: ${shopRows[0].count} rows`);
    
    if (miRows[0].count > 0) {
      const [integrations] = await sequelize.query('SELECT shop_id, platform, meta_asset_id, status FROM meta_integrations;');
      console.log('\nMeta Integrations:');
      console.log(JSON.stringify(integrations, null, 2));
    }
    
    if (ccRows[0].count > 0) {
      const [channels] = await sequelize.query('SELECT shop_id, channel_type, page_id, is_active FROM channel_configs;');
      console.log('\nChannels:');
      console.log(JSON.stringify(channels, null, 2));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

check();
