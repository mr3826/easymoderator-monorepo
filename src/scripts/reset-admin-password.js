require('module-alias/register');
require('dotenv').config();

// Force file-based SQLite
process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./database.sqlite';

// Load all models
const entities = require('src/modules/entities');

const { sequelize } = require('src/utils/database/database-setup');
const { User } = entities;
const { hashPassword } = require('src/utils/password.util');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345!';

async function resetAdminPassword() {
    await sequelize.authenticate();

    const user = await User.findOne({ where: { email: ADMIN_EMAIL } });
    if (!user) {
        console.log(`Admin user not found: ${ADMIN_EMAIL}`);
        return;
    }

    const hashedPassword = await hashPassword(ADMIN_PASSWORD);
    await user.update({ password: hashedPassword });

    console.log(`Admin password reset successfully`);
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
}

resetAdminPassword()
    .catch((error) => {
        console.error('Failed to reset admin password:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await sequelize.close();
        } catch (closeError) {
            console.error('Error closing database connection:', closeError);
        }
    });
