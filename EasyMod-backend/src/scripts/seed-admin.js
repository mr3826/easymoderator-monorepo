require('module-alias/register');
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

const requireInProduction = (key) => {
    if (env === 'production' && !process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return process.env[key];
};

// Force file-based SQLite in development only
if (!process.env.DATABASE_URL && env !== 'production') {
    process.env.DATABASE_URL = 'sqlite:./database.sqlite';
}

// Load all models by requiring entities first
const entities = require('../modules/entities');

const { sequelize } = require('../utils/database/database-setup');
const { User, Shop, UserShop, Tenant } = entities;
const { hashPassword } = require('../utils/password.util');
const { generateUniqueShopCode } = require('../modules/auth/auth.service');

const ADMIN_EMAIL = requireInProduction('SEED_ADMIN_EMAIL') || process.env.SEED_ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = requireInProduction('SEED_ADMIN_PASSWORD') || process.env.SEED_ADMIN_PASSWORD || 'Admin@12345!';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Test Admin';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || '+8801000000000';

async function ensureAdminUser() {
    await sequelize.authenticate();

    const existingUser = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (existingUser) {
        console.log(`Admin user already exists: ${existingUser.id}`);
        console.log(`Email: ${ADMIN_EMAIL}`);
        console.log('Password: (unchanged)');

        // Verify the existing user has at least one active shop.
        // An admin with no shops cannot log in (authenticateUser throws 403).
        // This can happen when the user was created in an earlier deployment
        // before the shop-creation step was added.
        const existingShop = await UserShop.findOne({
            where: { user_id: existingUser.id, is_active: true }
        });

        if (!existingShop) {
            console.log('No active shop found for admin — creating one...');
            const tenant = await Tenant.create({ name: 'Admin Tenant' });
            const shopCode = await generateUniqueShopCode();
            const shop = await Shop.create({
                unique_code: shopCode,
                tenant_id: tenant.id,
                name: 'Admin Test Shop',
                shop_name: 'Admin Test Shop'
            });
            await UserShop.create({
                user_id: existingUser.id,
                shop_id: shop.id,
                role: 'admin',
                is_active: true
            });
            await existingUser.update({ last_logged_shop_id: shop.id });
            console.log(`Shop created: ${shop.unique_code} (${shop.id})`);
        } else {
            console.log('Active shop found — no action needed.');
        }

        return;
    }

    const hashedPassword = await hashPassword(ADMIN_PASSWORD);
    const user = await User.create({
        email: ADMIN_EMAIL,
        password: hashedPassword,
        full_name: ADMIN_NAME,
        phone: ADMIN_PHONE
    });

    const tenant = await Tenant.create({
        name: 'Admin Tenant'
    });

    const shopCode = await generateUniqueShopCode();
    const shop = await Shop.create({
        unique_code: shopCode,
        tenant_id: tenant.id,
        name: 'Admin Test Shop',
        shop_name: 'Admin Test Shop'
    });

    await UserShop.create({
        user_id: user.id,
        shop_id: shop.id,
        role: 'admin',
        is_active: true
    });

    await user.update({ last_logged_shop_id: shop.id });

    console.log('Admin user created successfully');
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log('Password: (set)');
    console.log(`Shop Code: ${shop.unique_code}`);
}

ensureAdminUser()
    .catch((error) => {
        console.error('Failed to seed admin user:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await sequelize.close();
        } catch (closeError) {
            console.error('Error closing database connection:', closeError);
        }
    });
