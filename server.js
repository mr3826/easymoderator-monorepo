require('module-alias/register');

// Crash protection — register before anything async runs
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

(async () => {
    // Must run before config.js is required — populates process.env from AWS Secrets Manager
    await require('./src/config/secrets-loader')();

    const config = require('src/config/config');

    // P2-5: In production, disable raw console.log/warn; use structured logger (CloudWatch/Datadog ingest stdout)
    if (config.env === 'production') {
        console.log = () => {};
        console.warn = () => {};
    }

    const app = require('src/app');
    const { sequelize } = require('src/utils/database/database-setup');
    const { getRedisClient, closeRedis } = require('src/utils/redis-client');

    let server = null;

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

        server = app.listen(config.port, '0.0.0.0', () => {
            console.log(`Server running on port ${config.port}`);
        });
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        process.exit(1);
    }

    // P1-8: Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully...');
        try {
            if (server) await server.close();
            await sequelize.close();
            await closeRedis();
            process.exit(0);
        } catch (err) {
            console.error('Error during shutdown:', err);
            process.exit(1);
        }
    });
})();
