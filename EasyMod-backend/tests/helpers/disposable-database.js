'use strict';

/**
 * Refuse to let a destructive suite touch a database that is not obviously
 * disposable.
 *
 * The integration and meta-e2e suites truncate tables and run the migration
 * chain. A mistyped DATABASE_URL must abort before the first DROP, not after
 * it — so this is called at setup-file load time, before any model, migration
 * or fixture module is required.
 *
 * The check is on the resolved database NAME. A type check such as
 * `typeof name === 'string'` is not a guard: it passes just as happily for
 * "easymod_production".
 */

/**
 * The name must contain "test" or "e2e" as a WHOLE word, delimited by a
 * non-letter or a string boundary.
 *
 * The looser /e2e|test/i accepts "latest_snapshot" — "latest" contains "test" —
 * which is exactly the kind of near-miss that ends with a restored backup.
 */
const DISPOSABLE_NAME = /(?:^|[^a-z])(?:e2e|test)(?:[^a-z]|$)/i;

/**
 * The database name a connection string will actually connect to.
 * Returns '' for anything unparseable, so callers fail closed.
 */
const databaseNameFrom = (url) => {
    if (typeof url !== 'string' || url === '') return '';
    try {
        return new URL(url).pathname.replace(/^\//, '');
    } catch {
        return '';
    }
};

const isDisposableDatabase = (url) => DISPOSABLE_NAME.test(databaseNameFrom(url));

/**
 * @param {string} [url] connection string; defaults to process.env.DATABASE_URL
 * @param {string} [suite] name used in the error message
 * @throws if the database is not provably disposable
 */
const assertDisposableDatabase = (url = process.env.DATABASE_URL, suite = 'this suite') => {
    if (isDisposableDatabase(url)) return;
    const name = databaseNameFrom(url);
    throw new Error(
        `${suite} refuses to run against database "${name || url || '<unset>'}". `
        + 'It truncates tables and runs migrations, so DATABASE_URL must name a '
        + 'disposable database with "test" or "e2e" as a whole word '
        + '(e.g. easymod_e2e).',
    );
};

module.exports = {
    DISPOSABLE_NAME,
    databaseNameFrom,
    isDisposableDatabase,
    assertDisposableDatabase,
};
