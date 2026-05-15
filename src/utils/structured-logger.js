/**
 * Structured Logging Utility for Production
 * Ensures all logs are JSON-parseable for log aggregation (ELK, Datadog, etc)
 * Tracks request context, user actions, and side effects for auditing
 */

class StructuredLogger {
    constructor(context = {}) {
        this.context = {
            timestamp: new Date().toISOString(),
            service: process.env.SERVICE_NAME || 'easymod-api',
            environment: process.env.NODE_ENV || 'development',
            ...context
        };
    }

    /**
     * Log with automatic context injection
     */
    log(level, message, meta = {}) {
        const logEntry = {
            level,
            message,
            ...this.context,
            ...meta,
            timestamp: new Date().toISOString()
        };
        const out = JSON.stringify(logEntry);
        if (process.env.NODE_ENV === 'production') {
            process.stdout.write(out + '\n');
        } else {
            console.log(out);
        }
        return logEntry;
    }

    info(message, meta = {}) {
        return this.log('INFO', message, meta);
    }

    error(message, error, meta = {}) {
        return this.log('ERROR', message, {
            error: {
                message: error?.message,
                code: error?.code,
                // Stack traces expose internal file paths and line numbers.
                // Only include in non-production environments.
                ...(process.env.NODE_ENV !== 'production' && { stack: error?.stack })
            },
            ...meta
        });
    }

    warn(message, meta = {}) {
        return this.log('WARN', message, meta);
    }

    debug(message, meta = {}) {
        if (process.env.DEBUG_ENABLED === 'true') {
            return this.log('DEBUG', message, meta);
        }
    }

    /**
     * Track usage events for billing audit trail
     * CRITICAL: Must be called for every usage-impacting operation
     */
    logUsage(action, shopId, userId, details) {
        return this.log('USAGE', `Usage tracked: ${action}`, {
            action,
            shop_id: shopId,
            user_id: userId,
            category: 'billing',
            auditRequired: true,
            ...details
        });
    }

    /**
     * Track side effects (delivery dispatch, payment initiation, etc)
     */
    logSideEffect(action, resource, shopId, result, meta = {}) {
        return this.log('SIDE_EFFECT', `Side effect: ${action} on ${resource}`, {
            action,
            resource,
            shop_id: shopId,
            result: result === true ? 'success' : 'failed',
            critical: true,
            ...meta
        });
    }

    /**
     * Track financial transactions for reconciliation
     */
    logTransaction(type, amount, shopId, reference, meta = {}) {
        return this.log('TRANSACTION', `${type} transaction`, {
            type,
            amount,
            shop_id: shopId,
            reference,
            currency: 'BDT',
            critical: true,
            ...meta
        });
    }

    /**
     * Create child logger with additional context
     */
    child(additionalContext = {}) {
        return new StructuredLogger({
            ...this.context,
            ...additionalContext,
            requestId: additionalContext.requestId || this.context.requestId
        });
    }
}

/**
 * Factory to create logger with request context
 */
const createLogger = (requestId, shopId = null, userId = null) => {
    return new StructuredLogger({
        requestId,
        shop_id: shopId,
        user_id: userId
    });
};

module.exports = {
    StructuredLogger,
    createLogger
};
