require('module-alias/register');
const http = require('http');

/**
 * Queue Worker Process
 * Separate process for handling background jobs.
 *
 * Start order matters:
 * 1. Bind PORT immediately — Cloud Run's TCP probe fires within seconds
 * 2. Load secrets from GCP Secret Manager — populates DATABASE_URL etc.
 * 3. Require config-dependent modules (queue-manager, sequelize)
 * 4. Connect DB and start workers
 */
async function startWorker() {
    // 1. Bind port FIRST — before any other async work — so Cloud Run health probe passes
    const port = process.env.PORT || 8080;
    const healthServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('worker ok');
    });
    await new Promise((resolve) => healthServer.listen(port, resolve));
    console.log(`✅ Worker health server listening on port ${port}`);

    try {
        console.log('🚀 Starting Commerce AI Queue Worker...');

        // 2. Load secrets before any module that reads config (DATABASE_URL etc.)
        await require('../config/secrets-loader')();

        // 3. Load config-dependent modules after secrets are populated
        const { sequelize } = require('../utils/database/database-setup');
        const queueManager = require('./queue-manager');

        // 4. Connect DB
        await sequelize.authenticate();
        console.log('✅ Database connected');

        // 5. Schedule recurring jobs and start workers
        await queueManager.scheduleJobs();

        console.log('✅ Queue worker started successfully');
        console.log('📊 Worker is processing jobs...');

        // Graceful shutdown
        const shutdown = async () => {
            console.log('🛑 Shutting down worker gracefully...');
            healthServer.close();
            await queueManager.close();
            await sequelize.close();
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        console.error('❌ Worker startup failed:', error);
        process.exit(1);
    }
}

startWorker();
