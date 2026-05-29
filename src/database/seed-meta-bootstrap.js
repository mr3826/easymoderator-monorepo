'use strict';

/**
 * Meta Webhook Bootstrap Seed
 *
 * Creates (or refreshes) a placeholder `meta_channels` row so the first-ever
 * Meta Dashboard webhook verification (`GET /api/webhooks/meta?hub.challenge=…`)
 * can succeed before any real Page/IG account is connected.
 *
 * The webhook GET handler does a DB lookup on `webhook_verify_token` filtered
 * by `status='CONNECTED'`. Without any row, every dashboard verification returns
 * 403, blocking the initial webhook subscription setup.
 *
 * This script:
 *   1. Generates a strong random verify token
 *   2. Attaches it to the founder's dev shop as a bootstrap `facebook` channel
 *      (or refreshes the existing bootstrap row's token)
 *   3. Prints the token for use in the Meta App Dashboard webhook field
 *
 * Cleanup once a real channel is connected:
 *   npm run seed:meta-bootstrap -- --cleanup
 *
 * Usage:
 *   npm run seed:meta-bootstrap
 *   SEED_SHOP_ID=<shop-uuid> npm run seed:meta-bootstrap
 *   npm run seed:meta-bootstrap -- --cleanup
 */

require('module-alias/register');
require('dotenv').config();

const BOOTSTRAP_ASSET_ID = 'BOOTSTRAP-VERIFY-ONLY';
const BOOTSTRAP_DISPLAY = 'Bootstrap (webhook verify only — remove after first real connect)';

async function main() {
    await require('../config/secrets-loader')();

    const crypto = require('crypto');
    const { sequelize } = require('../utils/database/database-setup');
    const { Shop } = require('../modules/entities');
    const MetaChannel = require('../modules/channel-providers/meta-channel.entity');

    const cleanup = process.argv.includes('--cleanup');

    await sequelize.authenticate();
    console.log('[bootstrap] Database connected');

    if (cleanup) {
        const removed = await MetaChannel.destroy({
            where: { meta_asset_id: BOOTSTRAP_ASSET_ID }
        });
        console.log(`[bootstrap] Removed ${removed} bootstrap row(s).`);
        await sequelize.close();
        return;
    }

    let shop;
    if (process.env.SEED_SHOP_ID) {
        shop = await Shop.findByPk(process.env.SEED_SHOP_ID);
        if (!shop) throw new Error(`Shop ${process.env.SEED_SHOP_ID} not found`);
    } else {
        shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
        if (!shop) throw new Error('No shops in DB — run `npm run seed` first to create the dev shop.');
    }
    console.log(`[bootstrap] Using shop: ${shop.id} (${shop.shop_name || shop.name})`);

    const verifyToken = crypto.randomBytes(24).toString('hex');

    const [row, created] = await MetaChannel.findOrCreate({
        where: { shop_id: shop.id, platform: 'facebook' },
        defaults: {
            meta_asset_id: BOOTSTRAP_ASSET_ID,
            display_name: BOOTSTRAP_DISPLAY,
            webhook_verify_token: verifyToken,
            status: 'CONNECTED',
            connected_at: new Date()
        }
    });

    if (!created) {
        if (row.meta_asset_id !== BOOTSTRAP_ASSET_ID) {
            console.log('[bootstrap] A real facebook channel is already connected for this shop.');
            console.log('[bootstrap] No bootstrap row needed — use that channel\'s verify token instead:');
            console.log(`            ${row.webhook_verify_token}`);
            await sequelize.close();
            return;
        }
        await row.update({ webhook_verify_token: verifyToken, status: 'CONNECTED' });
        console.log('[bootstrap] Refreshed verify token on existing bootstrap row.');
    } else {
        console.log('[bootstrap] Created bootstrap meta_channels row.');
    }

    console.log('\n────────────────────────────────────────────────────────');
    console.log(' Webhook Verify Token (paste into Meta App Dashboard):');
    console.log(` ${verifyToken}`);
    console.log('────────────────────────────────────────────────────────');
    console.log(' Webhook Callback URL: https://easymod.tech/api/webhooks/meta');
    console.log(' (dev/ngrok: https://<your-tunnel>/api/webhooks/meta)');
    console.log('────────────────────────────────────────────────────────');
    console.log(' After you connect a real FB Page or IG account, run:');
    console.log('   npm run seed:meta-bootstrap -- --cleanup');
    console.log('────────────────────────────────────────────────────────\n');

    await sequelize.close();
}

main().catch((err) => {
    console.error('[bootstrap] Failed:', err);
    process.exit(1);
});
