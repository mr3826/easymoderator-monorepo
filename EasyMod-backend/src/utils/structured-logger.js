/**
 * Structured Logging Utility for Production
 * Ensures all logs are JSON-parseable for log aggregation (ELK, Datadog, etc)
 * Tracks request context, user actions, and side effects for auditing
 */

/**
 * Convert an Error into a JSON-serializable shape. A raw Error JSON.stringifies to
 * `{}` because message/stack/name are non-enumerable, so we copy the fields we want
 * explicitly. Stack traces leak internal paths → only included off-production.
 */
function serializeError(err) {
    const out = { message: err.message, name: err.name };
    if (err.code !== undefined) out.code = err.code;
    if (err.status !== undefined) out.status = err.status;
    if (err.statusCode !== undefined) out.statusCode = err.statusCode;
    if (process.env.NODE_ENV !== 'production') out.stack = err.stack;
    return out;
}

/**
 * Normalize whatever was passed as `meta` into a safe, fully-serializable object.
 * Crucially, this rescues two widespread call-site mistakes that used to log `{}`:
 *   - the whole meta arg IS an Error (passed to warn/info/debug)
 *   - a meta field VALUE is a raw Error (e.g. `{ error: errObj }`)
 */
function normalizeMeta(meta) {
    if (meta == null) return {};
    if (meta instanceof Error) return { error: serializeError(meta) };
    if (typeof meta !== 'object') return { value: meta };
    const out = {};
    for (const key of Object.keys(meta)) {
        const v = meta[key];
        out[key] = v instanceof Error ? serializeError(v) : v;
    }
    return out;
}

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
        return this.log('INFO', message, normalizeMeta(meta));
    }

    /**
     * Log an error. Robust to every shape the codebase uses for the 2nd arg:
     *   - an Error             → extracted into `error: { message, code, ... }`
     *   - a meta object        → spread as fields (the dominant `error('msg', {...})`
     *                            idiom); any nested Error value is serialized too
     *   - a primitive          → wrapped as `error: { message: String(arg) }`
     * The optional 3rd `meta` is always merged on top. Error detail is never dropped.
     */
    error(message, error, meta = {}) {
        if (error instanceof Error) {
            return this.log('ERROR', message, {
                error: serializeError(error),
                ...normalizeMeta(meta)
            });
        }
        if (error && typeof error === 'object') {
            return this.log('ERROR', message, {
                ...normalizeMeta(error),
                ...normalizeMeta(meta)
            });
        }
        if (error !== undefined && error !== null) {
            return this.log('ERROR', message, {
                error: { message: String(error) },
                ...normalizeMeta(meta)
            });
        }
        return this.log('ERROR', message, normalizeMeta(meta));
    }

    warn(message, meta = {}) {
        return this.log('WARN', message, normalizeMeta(meta));
    }

    debug(message, meta = {}) {
        if (process.env.DEBUG_ENABLED === 'true') {
            return this.log('DEBUG', message, normalizeMeta(meta));
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
