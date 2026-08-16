'use strict';

const { AppError } = require('../../utils/AppError');

// Keep decoded audio bounded before it is copied, base64-encoded again, and
// sent to the external transcription provider.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;

function decodeAudioBase64(value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new AppError('audioBase64 must be a non-empty base64 string', 400);
    }

    if (value.length > MAX_AUDIO_BASE64_LENGTH) {
        throw new AppError('Audio payload exceeds the 10 MB limit', 413);
    }

    // Accept canonical base64 only. Buffer.from is intentionally permissive and
    // silently ignores invalid characters, which could bypass a size check.
    const hasInvalidCharacters = /[^A-Za-z0-9+/=]/.test(value);
    const hasInvalidPadding = value.length % 4 !== 0
        || /={3,}/.test(value)
        || (value.includes('=') && !/={1,2}$/.test(value));
    if (hasInvalidCharacters || hasInvalidPadding) {
        throw new AppError('audioBase64 must be valid base64 audio data', 400);
    }

    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    const decodedLength = (value.length * 3) / 4 - padding;
    if (decodedLength > MAX_AUDIO_BYTES) {
        throw new AppError('Audio payload exceeds the 10 MB limit', 413);
    }

    const audioBuffer = Buffer.from(value, 'base64');
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
        throw new AppError('Audio payload exceeds the 10 MB limit', 413);
    }
    return audioBuffer;
}

module.exports = { MAX_AUDIO_BYTES, MAX_AUDIO_BASE64_LENGTH, decodeAudioBase64 };
