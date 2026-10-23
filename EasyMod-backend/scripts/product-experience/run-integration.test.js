'use strict';

const { resolveExternalServicePorts } = require('./run-integration');

describe('external loopback integration services', () => {
    test('keeps Docker as the default unless external services are explicitly selected', () => {
        expect(resolveExternalServicePorts({
            LAB_POSTGRES_PORT: '55432',
            LAB_REDIS_PORT: '56379',
        })).toBeNull();
        expect(resolveExternalServicePorts({ LAB_EXTERNAL_SERVICES: 'TRUE' })).toBeNull();
    });

    test('normalizes two valid distinct loopback ports for the external-service mode', () => {
        expect(resolveExternalServicePorts({
            LAB_EXTERNAL_SERVICES: 'true',
            LAB_POSTGRES_PORT: '55432',
            LAB_REDIS_PORT: '56379',
        })).toEqual({ postgresPort: 55432, redisPort: 56379 });
    });

    test.each([
        [{ LAB_EXTERNAL_SERVICES: 'true' }, 'LAB_POSTGRES_PORT and LAB_REDIS_PORT'],
        [{ LAB_EXTERNAL_SERVICES: 'true', LAB_POSTGRES_PORT: '5432' }, 'LAB_POSTGRES_PORT and LAB_REDIS_PORT'],
        [{ LAB_EXTERNAL_SERVICES: 'true', LAB_POSTGRES_PORT: '5432', LAB_REDIS_PORT: '5432' }, 'distinct'],
        [{ LAB_EXTERNAL_SERVICES: 'true', LAB_POSTGRES_PORT: '1023', LAB_REDIS_PORT: '56379' }, '1024'],
        [{ LAB_EXTERNAL_SERVICES: 'true', LAB_POSTGRES_PORT: '65536', LAB_REDIS_PORT: '56379' }, '65535'],
        [{ LAB_EXTERNAL_SERVICES: 'true', LAB_POSTGRES_PORT: '55abc', LAB_REDIS_PORT: '56379' }, 'integer TCP port'],
    ])('rejects unsafe or incomplete external endpoint configuration %#', (env, expectedMessage) => {
        expect(() => resolveExternalServicePorts(env)).toThrow(expectedMessage);
    });
});
