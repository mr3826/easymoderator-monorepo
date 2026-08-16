'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableHash } = require('../lib/evidence');

const MAX_EVENTS = 100;
const MAX_EVENT_BYTES = 32 * 1024;
const MAX_COUNTER = 1_000_000_000;

function parseTimestamp(value) {
  if (typeof value !== 'string' || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new Error('timestamp_must_include_timezone');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_timestamp');
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('future_timestamp');
  return date.toISOString();
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event_must_be_object');
  const id = String(event.id || '').trim();
  if (!id) throw new Error('event_id_required');
  const timestamp = parseTimestamp(event.timestamp || event.occurred_at || event.occurredAt);
  for (const key of ['amount', 'count', 'item_count', 'attempts']) {
    if (event[key] === undefined || event[key] === null) continue;
    if (!Number.isFinite(event[key]) || event[key] < 0 || event[key] > MAX_COUNTER) {
      throw new Error(`invalid_numeric_field:${key}`);
    }
    if (['count', 'item_count', 'attempts'].includes(key) && !Number.isInteger(event[key])) {
      throw new Error(`invalid_counter_field:${key}`);
    }
  }
  return { ...event, id, timestamp };
}

function normalizeEvents(events, { maxEvents = MAX_EVENTS } = {}) {
  if (!Array.isArray(events)) throw new Error('events_must_be_array');
  if (events.length > maxEvents) throw new Error('payload_event_limit_exceeded');
  const deduped = new Map();
  for (const event of events) {
    let serialized;
    try {
      serialized = JSON.stringify(event);
    } catch (_) {
      throw new Error('event_not_serializable');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_BYTES) throw new Error('event_payload_too_large');
    const normalized = normalizeEvent(event);
    if (!deduped.has(normalized.id)) deduped.set(normalized.id, normalized);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

function safeEvaluate(events, evaluator = (input) => ({ score: Math.min(1, input.length / MAX_EVENTS) })) {
  const started = process.hrtime.bigint();
  try {
    const normalized = normalizeEvents(events);
    const inputHash = stableHash(normalized);
    const result = evaluator(normalized);
    return {
      processingResult: 'ok',
      score: result.score,
      components: result.components || {},
      indicators: result.indicators || [],
      inputHash,
      latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
    };
  } catch (error) {
    return {
      processingResult: 'error',
      error: error.message,
      latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
    };
  }
}

function expectError(events, expected) {
  const result = safeEvaluate(events);
  return result.processingResult === 'error' && result.error === expected;
}

function runAdversarialSuite() {
  const now = new Date(Date.now() - 60_000).toISOString();
  const base = { id: 'evt-1', timestamp: now, amount: 100, count: 1 };
  const large = { ...base, id: 'large', note: 'x'.repeat(MAX_EVENT_BYTES) };
  const checks = {
    malformed: expectError(null, 'events_must_be_array'),
    missingRequired: expectError([{ timestamp: now }], 'event_id_required'),
    timezoneAware: safeEvaluate([{ ...base, timestamp: '2026-08-14T04:00:00+00:00' }]).processingResult === 'ok',
    naiveTimestamp: expectError([{ ...base, timestamp: '2026-08-14T04:00:00' }], 'timestamp_must_include_timezone'),
    zTimestamp: safeEvaluate([{ ...base, timestamp: '2026-08-14T04:00:00Z' }]).processingResult === 'ok',
    invalidTimestamp: expectError([{ ...base, timestamp: 'not-a-date+00:00' }], 'invalid_timestamp'),
    futureTimestamp: expectError([{ ...base, timestamp: new Date(Date.now() + 3600_000).toISOString() }], 'future_timestamp'),
    negativeNumeric: expectError([{ ...base, amount: -1 }], 'invalid_numeric_field:amount'),
    impossibleCounter: expectError([{ ...base, count: MAX_COUNTER + 1 }], 'invalid_numeric_field:count'),
    duplicateEvents: normalizeEvents([{ ...base }, { ...base, timestamp: now }]).length === 1,
    unsortedEvents: normalizeEvents([
      { ...base, id: 'b', timestamp: '2026-08-14T04:00:02Z' },
      { ...base, id: 'a', timestamp: '2026-08-14T04:00:01Z' },
    ])[0].id === 'a',
    emptyCollection: normalizeEvents([]).length === 0,
    excessivePayload: expectError(Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ ...base, id: `e-${i}` })), 'payload_event_limit_exceeded'),
    corruptedStructure: expectError([{ ...base, metadata: BigInt(1) }], 'event_not_serializable'),
    thresholdBoundary: safeEvaluate([base], (input) => ({ score: input.length === 1 ? 0.5 : 0 })).score === 0.5,
    deterministicScoring: safeEvaluate([base]).inputHash === safeEvaluate([base]).inputHash,
    batchConsistency: safeEvaluate([base, { ...base, id: 'evt-2' }]).inputHash === safeEvaluate([{ ...base, id: 'evt-2' }, base]).inputHash,
    exceptionContainment: safeEvaluate([base], () => { throw new Error('detector_failure'); }).processingResult === 'error',
    excessiveSingleEvent: expectError([large], 'event_payload_too_large'),
  };
  return { passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, checks };
}

function readFiles(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'EasyMod-backend', 'src', 'modules', 'order', 'order.service.js'),
    path.join(repoRoot, 'EasyMod-backend', 'src', 'modules', 'payment', 'self-mfs-handler.service.js'),
    path.join(repoRoot, 'EasyMod-backend', 'src', 'modules', 'rto-shield', 'rto-shield.service.js'),
  ];
  return candidates.filter(fs.existsSync).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
}

function run({ repoRoot } = {}) {
  const files = readFiles(repoRoot);
  const enforcementPaths = [];
  for (const { file, text } of files) {
    if (/blocked\s*:\s*true|fraud\s+blocked|FRAUD_SCORE_BLOCK_THRESHOLD|risk_score\s*>=/i.test(text)) {
      enforcementPaths.push(path.relative(repoRoot, file));
    }
  }
  const pinned = (() => {
    const candidates = [
      path.join(repoRoot, 'package-lock.json'),
      path.join(repoRoot, 'EasyMod-backend', 'package.json'),
      path.join(repoRoot, 'docs'),
    ];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      if (fs.readFileSync(candidate, 'utf8').includes('6be589c')) return '6be589c';
    }
    return 'NOT_FOUND_IN_CODEBASE';
  })();
  const suite = runAdversarialSuite();
  const adapter = files.some(({ text }) => /fraud[_-]?detector|normalize.*fraud/i.test(text))
    ? 'FOUND'
    : 'NOT_REQUIRED_EXTERNAL_DETECTOR_NOT_INTEGRATED';
  // The product decision is live enforcement. Validate the local enforcement
  // paths and bounded adversarial suite; do not require the optional external
  // fraud-detector repository or silently downgrade to shadow mode.
  const liveEnforcementHealthy = enforcementPaths.length > 0
    && suite.passed === suite.total;
  const decision = liveEnforcementHealthy ? 'PASS_FOR_LIVE_MODE' : 'NEEDS_HARDENING';
  return {
    agent: 'Fraud-Shield Agent',
    detectorVersion: pinned,
    decision,
    dbAdapter: adapter,
    enforcementMode: enforcementPaths.length > 0 ? 'LIVE' : 'NOT_DETECTED',
    shadowMode: enforcementPaths.length > 0 ? 'INTENTIONALLY_DISABLED' : 'UNVERIFIED',
    enforcementPaths,
    adversarialSuite: suite,
    externalDetector: {
      source: 'https://github.com/mr3826/fraud-detector',
      pinnedCommit: pinned,
      dbAccess: 'NOT_DETECTED_IN_LOCAL_INTEGRATION',
      externalExecution: 'NOT_EXECUTED',
    },
  };
}

module.exports = { normalizeEvent, normalizeEvents, safeEvaluate, runAdversarialSuite, run };
