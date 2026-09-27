'use strict';

describe('webhook payload cipher', () => {
    const primaryKey = 'a'.repeat(64);
    const previousKey = 'b'.repeat(64);

    beforeEach(() => {
        jest.resetModules();
        process.env.CHANNEL_ENCRYPTION_KEY = primaryKey;
        delete process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS;
    });

    test('encrypts with the primary key and decrypts with a configured previous key', () => {
        const cipher = require('../webhook-payload-cipher');
        const payload = { eventId: 'mid-rotation', text: 'redacted fixture' };
        process.env.CHANNEL_ENCRYPTION_KEY = previousKey;
        const oldCiphertext = cipher.encryptPayload(payload);

        process.env.CHANNEL_ENCRYPTION_KEY = primaryKey;
        process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS = previousKey;
        expect(cipher.decryptPayload(oldCiphertext)).toEqual(payload);
    });

    test('does not silently produce an unreplayable payload when the key is missing', () => {
        const cipher = require('../webhook-payload-cipher');
        delete process.env.CHANNEL_ENCRYPTION_KEY;
        expect(() => cipher.encryptPayload({ eventId: 'no-key' })).toThrow('CHANNEL_ENCRYPTION_KEY is not set');
    });
});
