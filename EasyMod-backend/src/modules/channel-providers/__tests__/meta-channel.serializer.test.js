'use strict';

const { serializeChannel } = require('../meta-channel.serializer');

function makeChannel(status) {
    return {
        toJSON: () => ({
            id: 'channel-1',
            status,
            page_access_token_ct: 'secret-page-token',
        }),
    };
}

describe('serializeChannel health fields', () => {
    test('marks CONNECTED channels healthy and never serializes the token', () => {
        const serialized = serializeChannel(makeChannel('CONNECTED'));

        expect(serialized).toEqual(expect.objectContaining({
            status: 'CONNECTED',
            isHealthy: true,
            needsReconnect: false,
        }));
        expect(serialized).not.toHaveProperty('page_access_token_ct');
    });

    test.each(['TOKEN_EXPIRED', 'REVOKED', 'ERROR'])(
        'marks %s channels as requiring reconnect',
        (status) => {
            expect(serializeChannel(makeChannel(status))).toEqual(expect.objectContaining({
                status,
                isHealthy: false,
                needsReconnect: true,
            }));
        },
    );

    test('does not mark DISCONNECTED channels healthy or reconnect-required', () => {
        expect(serializeChannel(makeChannel('DISCONNECTED'))).toEqual(expect.objectContaining({
            isHealthy: false,
            needsReconnect: false,
        }));
    });
});
