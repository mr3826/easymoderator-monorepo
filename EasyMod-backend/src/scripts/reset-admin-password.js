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

// Load all models
const entities = require('../modules/entities');

const { sequelize } = require('../utils/database/database-setup');
const { User } = entities;
const { hashPassword } = require('../utils/password.util');
const { invalidateUserSessions } = require('../modules/auth/session-invalidation.service');

const ADMIN_EMAIL = requireInProduction('SEED_ADMIN_EMAIL') || process.env.SEED_ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = requireInProduction('SEED_ADMIN_PASSWORD') || process.env.SEED_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD must be supplied through the environment; no default password is permitted.');
}

async function resetAdminPassword() {
    await sequelize.authenticate();

    const reset = await sequelize.transaction(async (transaction) => {
        const user = await User.findOne({
            where: { email: ADMIN_EMAIL },
            transaction,
            lock: transaction.LOCK?.UPDATE,
        });
        if (!user) {
            console.log(`Admin user not found: ${ADMIN_EMAIL}`);
            return false;
        }

        const hashedPassword = await hashPassword(ADMIN_PASSWORD);
        await user.update({ password: hashedPassword }, { transaction });
        await invalidateUserSessions(user.id, { transaction });
        return true;
    });

    if (!reset) return;

    console.log('Admin password reset successfully');
    console.log(`Email: ${ADMIN_EMAIL}`);
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
