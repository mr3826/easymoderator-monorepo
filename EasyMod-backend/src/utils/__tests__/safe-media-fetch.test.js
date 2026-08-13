'use strict';

const { EventEmitter } = require('events');
const {
    decodeDataImage,
    safeFetchMedia,
    _private,
} = require('../safe-media-fetch');

function mockRequest(responseFactory) {
    return (_url, _options, callback) => {
        const request = new EventEmitter();
        request.setTimeout = jest.fn();
        request.end = () => setImmediate(() => callback(responseFactory()));
        request.destroy = (error) => request.emit('error', error);
        return request;
    };
}

function response({ status = 200, headers = {}, chunks = [] }) {
    const stream = new EventEmitter();
    stream.statusCode = status;
    stream.headers = headers;
    stream.resume = jest.fn();
    stream.destroy = (error) => stream.emit('error', error);
    setImmediate(() => {
        for (const chunk of chunks) stream.emit('data', Buffer.from(chunk));
        stream.emit('end');
    });
    return stream;
}

describe('safe external media fetch policy', () => {
    const env = {
        BASE_URL: 'https://easymod.tech',
        MEDIA_FETCH_ALLOWED_HOSTS: 'media.easymod.tech',
    };
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

    test.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.16.1.1',
        '192.168.1.2',
        '169.254.169.254',
        '::1',
        'fc00::1',
        'fe80::1',
    ])('rejects non-public destination %s', (address) => {
        expect(_private.isPublicIp(address)).toBe(false);
    });

    test('accepts allowlisted Meta CDN and EasyModerator hosts only over HTTPS', () => {
        expect(_private.validateUrl('https://scontent.xx.fbcdn.net/image.jpg', env).hostname)
            .toBe('scontent.xx.fbcdn.net');
        expect(_private.validateUrl('https://media.easymod.tech/image.jpg', env).hostname)
            .toBe('media.easymod.tech');
        expect(() => _private.validateUrl('http://media.easymod.tech/image.jpg', env))
            .toThrow(/HTTPS/);
        expect(() => _private.validateUrl('https://localhost/image.jpg', env))
            .toThrow(/allowlisted/);
        expect(() => _private.validateUrl('https://example.com/image.jpg', env))
            .toThrow(/allowlisted/);
    });

    test('fetches a valid bounded image using a DNS-pinned address', async () => {
        const result = await safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
            requestImpl: mockRequest(() => response({
                headers: {
                    'content-type': 'image/png',
                    'content-length': String(png.length),
                },
                chunks: [png],
            })),
        });
        expect(result.mimeType).toBe('image/png');
        expect(result.buffer).toEqual(png);
    });

    test('rejects redirects whose DNS resolves to a private address', async () => {
        const lookup = jest.fn()
            .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
            .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup,
            requestImpl: mockRequest(() => response({
                status: 302,
                headers: { location: 'https://media.easymod.tech/private.png' },
            })),
        })).rejects.toThrow(/non-public/);
    });

    test('rejects oversized and invalid-MIME responses', async () => {
        const lookup = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup,
            maxBytes: 2,
            requestImpl: mockRequest(() => response({
                headers: { 'content-type': 'image/png', 'content-length': '3' },
            })),
        })).rejects.toThrow(/size limit/);
        await expect(safeFetchMedia('https://media.easymod.tech/a.txt', {
            env,
            lookup,
            requestImpl: mockRequest(() => response({
                headers: { 'content-type': 'text/plain' },
            })),
        })).rejects.toThrow(/MIME/);
    });

    test('rejects a response whose bytes spoof the declared image MIME type', async () => {
        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
            requestImpl: mockRequest(() => response({
                headers: { 'content-type': 'image/png' },
                chunks: ['not-a-png'],
            })),
        })).rejects.toThrow(/declared MIME/);
    });

    test('accepts only bounded canonical data images with matching signatures', () => {
        const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
        expect(decodeDataImage(dataUrl)).toEqual({
            buffer: png,
            mimeType: 'image/png',
        });
        expect(() => decodeDataImage('data:text/html;base64,PGgxPk5PVCBBTiBJTUFHRTwvaDE+'))
            .toThrow(/invalid/);
        expect(() => decodeDataImage('data:image/png;base64,bm90LWEtcG5n'))
            .toThrow(/declared MIME/);
        expect(() => decodeDataImage(dataUrl, { maxBytes: 4 }))
            .toThrow(/size limit/);
    });

    test('rejects a streamed response that exceeds the byte limit', async () => {
        const lookup = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup,
            maxBytes: 2,
            requestImpl: mockRequest(() => response({
                headers: { 'content-type': 'image/png' },
                chunks: ['three-bytes'],
            })),
        })).rejects.toThrow(/size limit/);
    });

    test('turns a connection timeout into a bounded fetch failure', async () => {
        const timeoutRequest = () => {
            const request = new EventEmitter();
            request.setTimeout = (_timeoutMs, callback) => setImmediate(callback);
            request.destroy = (error) => request.emit('error', error);
            request.end = jest.fn();
            return request;
        };
        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
            timeoutMs: 1,
            // Put the total deadline out of reach so only the socket timeout can
            // fire. Sharing one budget made this a race between a setImmediate
            // and a 1 ms timer, and timers run before check in an event-loop
            // iteration — so under CI load the total deadline won and this
            // asserted on whichever timer happened to get there first.
            totalTimeoutMs: 60_000,
            requestImpl: timeoutRequest,
        })).rejects.toThrow(/timed out/);
    });

    test('enforces a total deadline even when the response never completes', async () => {
        const hangingRequest = (_url, _options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.destroy = (error) => request.emit('error', error);
            request.end = () => {
                const stream = new EventEmitter();
                stream.statusCode = 200;
                stream.headers = { 'content-type': 'image/png' };
                stream.resume = jest.fn();
                stream.destroy = (error) => stream.emit('error', error);
                callback(stream);
            };
            return request;
        };

        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
            // The socket timeout is stubbed out entirely (setTimeout is a no-op
            // above), so the total deadline is the only thing that can end this
            // request — the response stream never completes.
            timeoutMs: 60_000,
            totalTimeoutMs: 1,
            requestImpl: hangingRequest,
        })).rejects.toThrow(/total timeout/);
    });

    // Both budgets default to the same value, so production behaviour is
    // unchanged by making the deadline injectable.
    test('the total deadline defaults to the connection timeout', async () => {
        const hangingRequest = (_url, _options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.destroy = (error) => request.emit('error', error);
            request.end = () => {
                const stream = new EventEmitter();
                stream.statusCode = 200;
                stream.headers = { 'content-type': 'image/png' };
                stream.resume = jest.fn();
                stream.destroy = (error) => stream.emit('error', error);
                callback(stream);
            };
            return request;
        };

        await expect(safeFetchMedia('https://media.easymod.tech/a.png', {
            env,
            lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
            timeoutMs: 1,
            requestImpl: hangingRequest,
        })).rejects.toThrow(/total timeout/);
    });
});
