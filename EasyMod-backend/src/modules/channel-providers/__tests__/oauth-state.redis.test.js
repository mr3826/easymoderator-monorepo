'use strict';

const mockEval = jest.fn();
jest.mock('../../../config/redis', () => ({
    cacheRedis: {
        _isMemoryFallback: false,
        set: jest.fn(),
        get: jest.fn(),
        eval: mockEval,
    },
}));

const store = require('../oauth-state.store');

describe('oauth-state.store Redis consumption', () => {
    test('uses one atomic Redis operation and returns the payload once', async () => {
        mockEval.mockResolvedValueOnce(JSON.stringify({ shopId: 'shop-1', platform: 'facebook' }));
        await expect(store.take('state-1')).resolves.toMatchObject({ shopId: 'shop-1' });
        expect(mockEval).toHaveBeenCalledTimes(1);
        expect(mockEval.mock.calls[0][2]).toBe('oauth:state:state-1');
    });

    test('returns null when the atomic consume reports no value', async () => {
        mockEval.mockResolvedValueOnce(null);
        await expect(store.take('state-1')).resolves.toBeNull();
    });
});
