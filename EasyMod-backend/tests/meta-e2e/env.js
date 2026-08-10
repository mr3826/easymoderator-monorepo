'use strict';

/**
 * Environment for the Meta-shaped E2E suite.
 *
 * Loaded through jest `setupFiles`, i.e. BEFORE any application module reads
 * process.env at require time (config/config.js, llm.service.js and
 * burst-coalescer.js all capture env at module load).
 *
 * Everything here is test-only:
 *   - META_APP_SECRET is an ISOLATED integration-test secret. The suite signs
 *     its own payloads with it and the real webhook route verifies them with
 *     the same HMAC code path, so nothing needs the production App Secret.
 *   - The LLM API keys are placeholders. Real network calls never leave the
 *     process: tests/meta-e2e/transport.js intercepts the provider transports.
 *
 * Anything already set in the environment wins, which is how CI points the
 * suite at its service containers.
 */

const def = (key, value) => {
    if (!process.env[key]) process.env[key] = value;
};

process.env.NODE_ENV = 'test';

// ── Infrastructure ───────────────────────────────────────────────────────────
// Defaults match `npm run docker:up` (EasyMod-backend/docker-compose.yml), with
// a DEDICATED database name so the suite can never truncate a dev catalog.
def('DATABASE_URL', 'postgres://easymod_user:easymod_password@127.0.0.1:5432/easymod_e2e');
def('DB_SSL', 'false');
def('REDIS_URL', 'redis://127.0.0.1:6379');

// ── Meta ─────────────────────────────────────────────────────────────────────
def('META_APP_ID', 'e2e-app-id');
def('META_APP_SECRET', 'e2e-isolated-app-secret-not-the-real-one');
def('META_WEBHOOK_VERIFY_TOKEN', 'e2e-verify-token');
def('META_GRAPH_API_VERSION', 'v22.0');

// ── Crypto ───────────────────────────────────────────────────────────────────
// meta-token-cipher (Page token at rest) and webhook-payload-cipher (durable
// receipt replay body) both read CHANNEL_ENCRYPTION_KEY.
def('CHANNEL_ENCRYPTION_KEY', 'e'.repeat(64));
def('PAYMENT_ENCRYPTION_KEY', 'd'.repeat(64));
def('DELIVERY_ENCRYPTION_KEY', 'c'.repeat(64));
def('JWT_ACCESS_SECRET', 'e2e-jwt-access-secret-at-least-32-chars');
def('JWT_REFRESH_SECRET', 'e2e-jwt-refresh-secret-at-least-32-char');
def('SESSION_SECRET', 'e2e-session-secret-at-least-32-characters');

// ── AI ───────────────────────────────────────────────────────────────────────
// Present so llm.service reaches its transport (which the suite intercepts)
// instead of short-circuiting on "API key not set".
def('GEMINI_API_KEY', 'e2e-gemini-key');
def('OPENAI_API_KEY', 'e2e-openai-key');
// Deterministic routing: no automatic escalation to the expensive tier.
def('LLM_AUTO_ESCALATE_TO_PRO', 'false');
// Gemini context caching is an input-token cost optimisation, not part of the
// trust boundary — but a cache hit moves the grounding block from the system
// instruction into the messages array. Raising the minimum prompt size past any
// real prompt keeps one request shape across the suite.
def('GEMINI_CACHE_MIN_CHARS', '99999999');
// The BanglaBERT classifier is an optional local microservice. Point it at a
// host the test transport answers as "unavailable" so the router takes the same
// keyword/LLM path it takes on any machine without that service running.
def('BERT_SERVICE_URL', 'http://bert.e2e.invalid');
// Photo analysis is a separate (vision) code path with its own tests.
def('AI_PHOTO_MATCH_ENABLED', 'false');
def('AI_VISION_ENABLED', 'false');

// ── Pipeline timing ──────────────────────────────────────────────────────────
// The burst coalescer debounces inbound messages by 8s in production. Zero here
// so the flush job is enqueued ready-to-run and the assertion is deterministic;
// the coalescing logic itself is covered by burst-coalescer.test.js.
def('AI_BURST_WINDOW_MS', '0');
def('AI_BURST_MAX_WAIT_MS', '0');
// The intent router's exact-match response cache is in-process and survives a
// database truncate. Disabling it makes every turn re-derive its answer from
// the catalog, which is exactly the property META-E2E-002 exists to prove:
// repeated pressure must not be answered from a replayed earlier reply.
def('INTENT_CACHE_TTL_SECONDS', '0');

// ── Noise suppression ────────────────────────────────────────────────────────
delete process.env.SLACK_ALERT_WEBHOOK_URL;
delete process.env.SENTRY_DSN;
delete process.env.QDRANT_URL;
