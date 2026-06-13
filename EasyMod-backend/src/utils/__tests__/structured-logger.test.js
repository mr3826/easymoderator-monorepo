/**
 * StructuredLogger contract tests.
 *
 * The logger's own method signatures disagree with how ~50+ call sites across the
 * codebase actually use it, which silently dropped error detail to `error: {}`:
 *
 *   - `warn/info/debug(message, meta)` expect meta, but callers passed raw Errors.
 *     `{...error}` spreads to `{}` (message/stack are non-enumerable) → error lost.
 *   - `error(message, error, meta)` expects an Error in slot 2, but the dominant
 *     idiom is `error('msg', { error: err.message, ...ctx })` (a meta object). That
 *     object was treated as the Error, its absent `.message` logged as `error: {}`,
 *     and the real context + message dropped.
 *   - Even when meta is an object, a nested raw Error value (`{ error: errObj }`)
 *     JSON-stringifies to `{}`.
 *
 * These tests lock the hardened contract: error detail is NEVER silently dropped,
 * regardless of which of these shapes the caller used. `log()` returns the built
 * entry, so we assert on the return value directly (no stdout capture needed).
 */

const { StructuredLogger, createLogger } = require('../structured-logger');

describe('StructuredLogger — error detail is never dropped', () => {
    let logger;
    const ORIGINAL_ENV = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'test'; // non-production → stacks included
        logger = new StructuredLogger();
    });
    afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_ENV;
    });

    describe('warn/info/debug given a raw Error in the meta slot', () => {
        test('warn(msg, error) surfaces the error message instead of {}', () => {
            const err = new Error('db connection refused');
            const entry = logger.warn('Failed to check existing execution', err);
            expect(entry.error).toBeDefined();
            expect(entry.error.message).toBe('db connection refused');
        });

        test('info(msg, error) surfaces the error message', () => {
            const err = new Error('rate limited');
            const entry = logger.info('upstream hiccup', err);
            expect(entry.error.message).toBe('rate limited');
        });
    });

    describe('error() called with a meta object (the dominant codebase idiom)', () => {
        test('error(msg, { error: msg, ...ctx }) keeps the message AND the context', () => {
            const entry = logger.error('Secret lookup failed', {
                error: 'boom',
                integrationId: 'int-1',
            });
            expect(entry.error).toBe('boom');
            expect(entry.integrationId).toBe('int-1');
        });

        test('error(msg, { ...ctx, error: ErrorInstance }) serializes the nested Error', () => {
            const err = new Error('gemini timeout');
            const entry = logger.error('Error processing voice message', {
                messageId: 'm-1',
                error: err,
            });
            expect(entry.messageId).toBe('m-1');
            expect(entry.error.message).toBe('gemini timeout');
        });
    });

    describe('error() called the originally-intended way still works', () => {
        test('error(msg, ErrorInstance) extracts message/code', () => {
            const err = new Error('initialize payment error');
            err.code = 'PAY_500';
            const entry = logger.error('Initialize payment error', err);
            expect(entry.error.message).toBe('initialize payment error');
            expect(entry.error.code).toBe('PAY_500');
        });

        test('error(msg, ErrorInstance, meta) preserves the 3-arg form', () => {
            const err = new Error('handler blew up');
            const entry = logger.error('webhook handler error', err, { provider: 'redx' });
            expect(entry.error.message).toBe('handler blew up');
            expect(entry.provider).toBe('redx');
        });

        test('error(msg, "string reason") wraps the primitive as a message', () => {
            const entry = logger.error('something failed', 'not-an-error-object');
            expect(entry.error.message).toBe('not-an-error-object');
        });
    });

    describe('plain meta is unchanged (regression guard)', () => {
        test('info(msg, { count }) passes meta through verbatim', () => {
            const entry = logger.info('processed batch', { count: 5 });
            expect(entry.count).toBe(5);
            expect(entry.error).toBeUndefined();
        });

        test('warn(msg, { shopId }) passes meta through verbatim', () => {
            const entry = logger.warn('slow query', { shopId: 's-9' });
            expect(entry.shopId).toBe('s-9');
        });
    });

    describe('production hides stack traces', () => {
        test('stack omitted in production, present otherwise', () => {
            const err = new Error('leaky');

            process.env.NODE_ENV = 'production';
            const prodEntry = new StructuredLogger().error('boom', err);
            expect(prodEntry.error.stack).toBeUndefined();

            process.env.NODE_ENV = 'test';
            const devEntry = new StructuredLogger().error('boom', err);
            expect(typeof devEntry.error.stack).toBe('string');
        });
    });

    test('createLogger still produces a working logger', () => {
        const l = createLogger('req-1', 'shop-1', 'user-1');
        const entry = l.error('boom', new Error('x'));
        expect(entry.requestId).toBe('req-1');
        expect(entry.error.message).toBe('x');
    });
});
