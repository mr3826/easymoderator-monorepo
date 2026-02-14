require('module-alias/register');
const config = require('src/config/config');

const app = require('src/app');
const { sequelize } = require('src/utils/database/database-setup');
const { getRedisClient } = require('src/utils/redis-client');

const startServer = async () => {
    try {
        // Database Connection
        await sequelize.authenticate();
        console.log('Database connection established successfully.');

        // Ensure Redis is available for production/staging
        if (config.env === 'production' || config.env === 'staging') {
            const redis = getRedisClient();
            await redis.ping();
        }

        // Sync models (disable in production or use migrations)
        if (config.env === 'development') {
            await sequelize.sync({ force: false });
        } 

        app.listen(config.port, '0.0.0.0', () => {
            console.log(`Server running on port ${config.port}`);
        });
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        process.exit(1);
    }
};

startServer();
