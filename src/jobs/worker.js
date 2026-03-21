require('module-alias/register');
const queueManager = require('./queue-manager');
const { sequelize } = require('../utils/database/database-setup');

/**
 * Queue Worker Process
 * Separate process for handling background jobs
 */
async function startWorker() {
    try {
        console.log('🚀 Starting Commerce AI Queue Worker...');

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
