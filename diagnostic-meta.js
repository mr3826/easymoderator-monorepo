require("dotenv").config();
const { sequelize } = require("./src/utils/database/database-setup");
const MetaIntegration = require("./src/modules/integration/meta-integration.entity");
const Channel = require("./src/modules/channel/channel.entity");

async function diagnose() {
  try {
    console.log("\n=== META INTEGRATION DIAGNOSTIC ===\n");
    
    const integrations = await MetaIntegration.findAll();
    console.log(`Found ${integrations.length} Meta integrations:`);
    integrations.forEach(i => {
      console.log(`  - Shop: ${i.shop_id}, Platform: ${i.platform}, Asset ID: ${i.meta_asset_id}, Status: ${i.status}`);
    });
    
    const channels = await Channel.findAll();
    console.log(`\nFound ${channels.length} Channels:`);
    channels.forEach(c => {
      console.log(`  - Shop: ${c.shop_id}, Type: ${c.channel_type}, Page ID: ${c.page_id}, Active: ${c.is_active}, Has Token: ${!!c.access_token}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

diagnose();
