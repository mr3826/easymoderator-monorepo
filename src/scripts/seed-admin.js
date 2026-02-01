require('module-alias/register');
require('dotenv').config();

// Force file-based SQLite for seeding (not in-memory)
process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./database.sqlite';

// Load all models by requiring entities first
const entities = require('src/modules/entities');

const { sequelize } = require('src/utils/database/database-setup');
const { User, Shop, UserShop } = entities;
const { hashPassword } = require('src/utils/password.util');
const { generateUniqueShopCode } = require('src/modules/auth/auth.service');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345!';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Test Admin';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || '+8801000000000';

async function ensureAdminUser() {
    await sequelize.authenticate();
    
    // Sync database schema first
    // await sequelize.sync({ alter: true });
    console.log('Database schema synced');

    const existingUser = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (existingUser) {
        console.log(`Admin user already exists: ${existingUser.id}`);
        console.log(`Email: ${ADMIN_EMAIL}`);
        console.log('Password: (unchanged)');
        return;
    }

    const hashedPassword = await hashPassword(ADMIN_PASSWORD);
    const user = await User.create({
        email: ADMIN_EMAIL,
        password: hashedPassword,
        full_name: ADMIN_NAME,
        phone: ADMIN_PHONE
    });

    const shopCode = await generateUniqueShopCode();
    const shop = await Shop.create({
        unique_code: shopCode,
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
    console.log(`Password: ${ADMIN_PASSWORD}`);
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
