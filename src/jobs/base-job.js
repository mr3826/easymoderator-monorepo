const { AuditLog } = require('../modules/entities');
const { createLogger } = require('../utils/structured-logger');
const { cacheRedis } = require('../config/redis.js');

// Redis lock TTL: 2 hours. Covers the longest expected job run with headroom.
const JOB_LOCK_TTL_SECONDS = 7200;

/**
 * Base Job Class
 * Provides idempotent, re-runnable job execution with audit logging and metrics
 */
class BaseJob {
    constructor(jobName) {
        this.jobName = jobName;
        this.logger = createLogger(null, null);
        this.metrics = {
            startTime: null,
            endTime: null,
            duration: null,
            recordsProcessed: 0,
            recordsSucceeded: 0,
            recordsFailed: 0,
            errors: []
        };
    }

    /**
     * Execute job with idempotency and audit logging
     * @param {Object} options - Job execution options
     * @param {boolean} options.dryRun - If true, no database changes are made
     * @param {Date} options.runDate - Date to run job for (defaults to now)
     * @returns {Promise<Object>} - Job execution result
     */
    async execute(options = {}) {
        const { dryRun = false, runDate = new Date() } = options;
        const executionId = this.generateExecutionId(runDate);
        const lockKey = `job-lock:${this.jobName}:${executionId}`;

        this.logger.info(`[${this.jobName}] Starting execution`, {
            executionId,
            dryRun,
            runDate: runDate.toISOString()
        });

        this.metrics.startTime = Date.now();

        // Acquire distributed Redis lock — prevents duplicate runs on multi-instance deployments.
        // Dry-runs skip the lock so they can always be triggered for testing.
        if (!dryRun) {
            const locked = await this._acquireJobLock(lockKey);
            if (!locked) {
                this.logger.warn(`[${this.jobName}] Another instance holds the lock, skipping`, {
                    executionId, lockKey
                });
                return { status: 'skipped', reason: 'lock_held', executionId };
            }
        }

        try {
            // Check if job already executed for this period (AuditLog-based idempotency)
            const existingExecution = await this.checkExistingExecution(executionId);
            if (existingExecution && !dryRun) {
                this.logger.warn(`[${this.jobName}] Already executed`, {
                    executionId,
                    previousExecution: existingExecution.created_at
                });
                return {
                    status: 'skipped',
                    reason: 'already_executed',
                    previousExecution: existingExecution
                };
            }

            // Run the job
            const result = await this.run({ dryRun, runDate, executionId });

            this.metrics.endTime = Date.now();
            this.metrics.duration = this.metrics.endTime - this.metrics.startTime;

            // Write audit log (only if not dry-run)
            if (!dryRun) {
                await this.writeAuditLog(executionId, result);
            }

            // Emit metrics
            this.emitMetrics(result);

            this.logger.info(`[${this.jobName}] Completed successfully`, {
                executionId,
                dryRun,
                metrics: this.metrics,
                result
            });

            return {
                status: 'success',
                executionId,
                dryRun,
                metrics: this.metrics,
                result
            };

        } catch (error) {
            this.metrics.endTime = Date.now();
            this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
            this.metrics.errors.push(error.message);

            this.logger.error(`[${this.jobName}] Failed`, error, {
                executionId,
                dryRun,
                metrics: this.metrics
            });

            // Write error audit log (only if not dry-run)
            if (!dryRun) {
                await this.writeErrorAuditLog(executionId, error);
            }

            throw error;
        } finally {
            // Always release the lock — whether the job succeeded or failed
            if (!dryRun) {
                await this._releaseJobLock(lockKey);
            }
        }
    }

    /**
     * Attempt to acquire a Redis distributed lock using SET NX EX (atomic).
     * Returns true if the lock was acquired (this instance should proceed).
     * Returns true if Redis is unavailable — fail open, prefer running over blocking.
     */
    async _acquireJobLock(lockKey) {
        try {
            if (cacheRedis && cacheRedis.status === 'ready') {
                const result = await cacheRedis.set(lockKey, '1', 'EX', JOB_LOCK_TTL_SECONDS, 'NX');
                return result === 'OK'; // null means key already existed
            }
            return true; // No Redis: fall through to AuditLog idempotency only
        } catch (error) {
            this.logger.warn(`Failed to acquire job lock, proceeding without it`, { lockKey, error: error.message });
            return true; // fail open
        }
    }

    /**
     * Release the Redis job lock. Best-effort — errors are swallowed.
     */
    async _releaseJobLock(lockKey) {
        try {
            if (cacheRedis && cacheRedis.status === 'ready') {
                await cacheRedis.del(lockKey);
            }
        } catch (error) {
            this.logger.warn(`Failed to release job lock`, { lockKey, error: error.message });
        }
    }

    /**
     * Generate unique execution ID for idempotency
     * @param {Date} runDate 
     * @returns {string}
     */
    generateExecutionId(runDate) {
        const dateStr = runDate.toISOString().split('T')[0]; // YYYY-MM-DD
        return `${this.jobName}-${dateStr}`;
    }

    /**
     * Check if job already executed for this execution ID
     * @param {string} executionId 
     * @returns {Promise<Object|null>}
     */
    async checkExistingExecution(executionId) {
        try {
            const existingLog = await AuditLog.findOne({
                where: {
                    action: `job:${this.jobName}`,
                    metadata: {
                        executionId
                    }
                },
                order: [['created_at', 'DESC']]
            });

            return existingLog;
        } catch (error) {
            this.logger.warn(`Failed to check existing execution`, error);
            return null;
        }
    }

    /**
     * Write audit log for successful execution
     * @param {string} executionId 
     * @param {Object} result 
     */
    async writeAuditLog(executionId, result) {
        try {
            await AuditLog.create({
                action: `job:${this.jobName}`,
                resource_type: 'job',
                resource_id: executionId,
                user_id: null, // System job
                shop_id: null, // System-wide job
                metadata: {
                    executionId,
                    metrics: this.metrics,
                    result
                },
                ip_address: 'system',
                user_agent: `cron-job/${this.jobName}`
            });
        } catch (error) {
            this.logger.error('Failed to write audit log', error);
        }
    }

    /**
     * Write error audit log
     * @param {string} executionId 
     * @param {Error} error 
     */
    async writeErrorAuditLog(executionId, error) {
        try {
            await AuditLog.create({
                action: `job:${this.jobName}:error`,
                resource_type: 'job',
                resource_id: executionId,
                user_id: null,
                shop_id: null,
                metadata: {
                    executionId,
                    error: {
                        message: error.message,
                        stack: error.stack
                    },
                    metrics: this.metrics
                },
                ip_address: 'system',
                user_agent: `cron-job/${this.jobName}`
            });
        } catch (auditError) {
            this.logger.error('Failed to write error audit log', auditError);
        }
    }

    /**
     * Emit metrics (can be sent to monitoring service)
     * @param {Object} result 
     */
    emitMetrics(result) {
        const metrics = {
            job: this.jobName,
            duration_ms: this.metrics.duration,
            records_processed: this.metrics.recordsProcessed,
            records_succeeded: this.metrics.recordsSucceeded,
            records_failed: this.metrics.recordsFailed,
            error_count: this.metrics.errors.length,
            timestamp: new Date().toISOString()
        };

        // Log metrics (can be replaced with actual monitoring service)
        this.logger.info(`[${this.jobName}] Metrics emitted`, { metrics });

        // TODO: Send to monitoring service (Prometheus, DataDog, etc.)
        // Example: prometheusClient.recordMetrics(metrics);
    }

    /**
     * Abstract method - must be implemented by subclasses
     * @param {Object} options 
     */
    async run(options) {
        throw new Error('run() must be implemented by subclass');
    }
}

module.exports = BaseJob;
