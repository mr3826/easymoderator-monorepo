/**
 * Redis memory headroom reporting for GET /health/detailed.
 *
 * Redis runs `noeviction` because it backs BullMQ: exhausting maxmemory must
 * fail writes rather than silently drop queued jobs. That trade is only safe
 * while there is headroom, so this has to report it truthfully — a fabricated
 * "plenty free" is the one answer worse than no answer at all.
 */

jest.mock('../../utils/database/database-setup', () => ({ sequelize: {} }));
jest.mock('../../config/redis', () => ({
    checkRedisAvailability: () => ({}),
    cacheRedis: { info: jest.fn() },
}));
jest.mock('../../middleware/auth.middleware', () => ({ authenticate: (_r, _s, n) => n() }));

const { parseRedisMemory } = require('../health.routes');

/** A real `INFO memory` payload, trimmed to the fields that are read. */
const info = ({ used = 14953248, max = 268435456, peak = 17021440, policy = 'noeviction' } = {}) => [
    '# Memory',
    `used_memory:${used}`,
    'used_memory_human:14.26M',
    `used_memory_peak:${peak}`,
    `maxmemory:${max}`,
    `maxmemory_policy:${policy}`,
    'mem_fragmentation_ratio:1.54',
].join('\r\n');

describe('parseRedisMemory', () => {
    it('reports usage, ceiling, peak and the live eviction policy', () => {
        expect(parseRedisMemory(info())).toEqual({
            usedBytes: 14953248,
            maxBytes: 268435456,
            peakBytes: 17021440,
            policy: 'noeviction',
            usedPercent: 5.6,
        });
    });

    // The whole reason this exists: if the policy ever drifts back to evicting
    // keys, BullMQ can lose jobs silently. It must be visible, not inferred.
    it('surfaces a policy that has drifted back to evicting keys', () => {
        expect(parseRedisMemory(info({ policy: 'allkeys-lru' })).policy).toBe('allkeys-lru');
    });

    it('reports a genuinely full instance as full', () => {
        expect(parseRedisMemory(info({ used: 268435456 })).usedPercent).toBe(100);
    });

    it('reports unknown headroom as null when maxmemory is unset', () => {
        const parsed = parseRedisMemory(info({ max: 0 }));
        expect(parsed.usedPercent).toBeNull();
        expect(parsed.maxBytes).toBe(0);
    });

    it('reports nulls rather than NaN for a payload it cannot read', () => {
        expect(parseRedisMemory('')).toEqual({
            usedBytes: null, maxBytes: null, peakBytes: null, policy: null, usedPercent: null,
        });
    });

    it('does not match a field by suffix', () => {
        // `used_memory_peak` must never be read as `used_memory`.
        expect(parseRedisMemory(info()).usedBytes).toBe(14953248);
    });
});
