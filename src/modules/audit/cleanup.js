const { sequelize } = require('../utils/database/database-setup');
const auditService = require('./audit.service');

/**
 * Cleanup script for expired idempotency keys
 * This should be run periodically (e.g., daily) via cron job
 */
async function cleanupExpiredIdempotencyKeys() {
    try {
        console.log('Starting cleanup of expired idempotency keys...');

        await sequelize.authenticate();
        console.log('Database connection established.');

        const deletedCount = await auditService.cleanupExpiredIdempotencyKeys();

        console.log(`Successfully cleaned up ${deletedCount} expired idempotency keys.`);
        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
}

// Run cleanup if this script is executed directly
if (require.main === module) {
    cleanupExpiredIdempotencyKeys();
}

module.exports = { cleanupExpiredIdempotencyKeys };