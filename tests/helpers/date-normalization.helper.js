/**
 * Date normalization helpers for tests
 * Handles comparison between Date objects and ISO date strings
 * Ensures test assertions work whether DB returns Dates or strings
 */

const DATE_FORMATS = {
  ISO: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/,
  DATE_ONLY: /^\d{4}-\d{2}-\d{2}$/,
  TIMESTAMP: /^\d{10}$/
};

/**
 * Normalize value to ISO string for comparison
 * Handles: Date objects, ISO strings, timestamps, null, undefined
 * 
 * @param {any} val - Value to normalize
 * @returns {string|null} ISO string or null if input is falsy
 */
const normalizeDateValue = (val) => {
  if (val === null || val === undefined) {
    return null;
  }

  // Already an ISO string
  if (typeof val === 'string' && DATE_FORMATS.ISO.test(val)) {
    return val;
  }

  // Date object - convert to ISO string
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString();
  }

  // Unix timestamp (seconds or ms)
  if (typeof val === 'number' && val > 0) {
    const ms = val > 10000000000 ? val : val * 1000; // Distinguish seconds vs ms
    return new Date(ms).toISOString();
  }

  // Date-only string YYYY-MM-DD - convert to ISO
  if (typeof val === 'string' && DATE_FORMATS.DATE_ONLY.test(val)) {
    return new Date(val + 'T00:00:00Z').toISOString();
  }

  return null;
};

/**
 * Custom Jest matcher for date comparisons
 * Usage: expect(result.created_at).toEqualDate(mock.created_at)
 */
const toEqualDate = (received, expected) => {
  const receivedNorm = normalizeDateValue(received);
  const expectedNorm = normalizeDateValue(expected);

  const pass = receivedNorm === expectedNorm;

  return {
    pass,
    message: () =>
      pass
        ? `Expected date NOT to equal: ${expectedNorm}\nReceived: ${receivedNorm}`
        : `Expected date to equal: ${expectedNorm}\nReceived: ${receivedNorm}`
  };
};

/**
 * Custom Jest matcher for date being close (within tolerance)
 * Usage: expect(result.created_at).toBeCloseToDate(new Date(), 5000) // Within 5 seconds
 */
const toBeCloseToDate = (received, expected, toleranceMs = 1000) => {
  const receivedNorm = normalizeDateValue(received);
  const expectedNorm = normalizeDateValue(expected);

  if (!receivedNorm || !expectedNorm) {
    return {
      pass: false,
      message: () => `Invalid dates for comparison`
    };
  }

  const receivedTime = new Date(receivedNorm).getTime();
  const expectedTime = new Date(expectedNorm).getTime();
  const diff = Math.abs(receivedTime - expectedTime);
  const pass = diff <= toleranceMs;

  return {
    pass,
    message: () =>
      pass
        ? `Expected date NOT to be close (within ${toleranceMs}ms) to: ${expectedNorm}\nReceived: ${receivedNorm} (diff: ${diff}ms)`
        : `Expected date to be close (within ${toleranceMs}ms) to: ${expectedNorm}\nReceived: ${receivedNorm} (diff: ${diff}ms)`
  };
};

/**
 * Recursively normalize all date fields in an object
 * @param {Object} obj - Object potentially containing date fields
 * @param {Array} dateFields - Keys known to be dates (if not provided, guesses)
 * @returns {Object} New object with normalized dates
 */
const normalizeObjectDates = (obj, dateFields = null) => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => normalizeObjectDates(item, dateFields));
  }

  const normalized = {};

  for (const [key, value] of Object.entries(obj)) {
    // Known date fields
    if (dateFields && dateFields.includes(key)) {
      normalized[key] = normalizeDateValue(value);
      continue;
    }

    // Guess date fields by common names
    if (/^(created|updated|deleted|timestamp|date|at|_at)$/i.test(key)) {
      normalized[key] = normalizeDateValue(value);
      continue;
    }

    // Recurse into nested objects
    if (typeof value === 'object' && value !== null) {
      normalized[key] = normalizeObjectDates(value, dateFields);
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
};

/**
 * Create a mock with date fields properly formatted
 * @param {Object} baseMock - Base mock object
 * @param {Object} overrides - Values to override
 * @param {string} dateFormat - Format for dates: 'iso' (default), 'date', 'timestamp'
 * @returns {Object} Mock with formatted dates
 */
const createDateMock = (
  baseMock,
  overrides = {},
  dateFormat = 'iso'
) => {
  const mock = { ...baseMock, ...overrides };

  for (const [key, value] of Object.entries(mock)) {
    if (/^(created|updated|deleted|timestamp|date|at|_at)$/i.test(key)) {
      const normalized = normalizeDateValue(value);

      if (normalized) {
        switch (dateFormat.toLowerCase()) {
          case 'iso':
            mock[key] = normalized;
            break;
          case 'date':
            mock[key] = new Date(normalized);
            break;
          case 'timestamp':
            mock[key] = new Date(normalized).getTime() / 1000;
            break;
        }
      }
    }
  }

  return mock;
};

module.exports = {
  normalizeDateValue,
  normalizeObjectDates,
  createDateMock,
  toEqualDate,
  toBeCloseToDate,
  DATE_FORMATS
};
