'use strict';

const { MAX_AUDIO_BYTES, decodeAudioBase64 } = require('../voice-processing.limits');

describe('voice processing input limits', () => {
    test('decodes canonical base64 within the byte limit', () => {
        expect(decodeAudioBase64(Buffer.from('audio').toString('base64'))).toEqual(Buffer.from('audio'));
    });

    test('rejects malformed base64 instead of silently decoding it', () => {
        expect(() => decodeAudioBase64('not base64!')).toThrow(/valid base64/);
    });

    test('rejects decoded audio above the 10 MB limit before provider submission', () => {
        const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');
        expect(() => decodeAudioBase64(oversized)).toThrow(/10 MB/);
    });
});
