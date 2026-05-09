require('module-alias/register');
const http = require('http');
const queueManager = require('./queue-manager');
const { sequelize } = require('../utils/database/database-setup');

/**
 * Queue Worker Process
 * Separate process for handling background jobs.
 * Cloud Run requires every container to bind PORT — the health server satisfies that
 * without exposing any application routes.
 */
async function startWorker() {
    try {
        console.log('🚀 Starting Commerce AI Queue Worker...');

        // Minimal health server — Cloud Run kills containers that don't bind PORT
        const port = process.env.PORT || 8080;
        const healthServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('worker ok');
        });
        healthServer.listen(port, () => {
            console.log(`✅ Worker health server listening on port ${port}`);
        });

        // Initialize database connection
        await sequelize.authenticate();
        console.log('✅ Database connected');

        // Schedule recurring jobs
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
