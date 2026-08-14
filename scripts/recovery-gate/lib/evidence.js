'use strict';

const crypto = require('crypto');

function utcNow() {
  return new Date().toISOString();
}

function parseUtc(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationMs(start, end) {
  const startDate = parseUtc(start);
  const endDate = parseUtc(end);
  if (!startDate || !endDate || endDate < startDate) return null;
  return endDate.getTime() - startDate.getTime();
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'NOT_MEASURED';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function calculateRpo({ failureUtc, latestDbUtc, latestMediaUtc }) {
  const dbMs = durationMs(latestDbUtc, failureUtc);
  const mediaMs = durationMs(latestMediaUtc, failureUtc);
  const values = [dbMs, mediaMs].filter((value) => value !== null);
  return {
    dbMs,
    mediaMs,
    observedMs: values.length === 2 ? Math.max(...values) : null,
    db: formatDuration(dbMs),
    media: formatDuration(mediaMs),
    observed: values.length === 2 ? formatDuration(Math.max(...values)) : 'NOT_MEASURED',
  };
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class EvidenceRecorder {
  constructor() {
    this.startedAt = utcNow();
    this.events = [];
  }

  record(agent, event, details = {}) {
    this.events.push({
      agent,
      event,
      atUtc: utcNow(),
      ...details,
    });
  }

  snapshot() {
    return {
      recorderStartedUtc: this.startedAt,
      capturedAtUtc: utcNow(),
      events: this.events.slice(),
    };
  }
}

module.exports = {
  utcNow,
  parseUtc,
  durationMs,
  formatDuration,
  calculateRpo,
  stableHash,
  EvidenceRecorder,
};
