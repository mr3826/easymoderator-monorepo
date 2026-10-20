'use strict';

const http = require('node:http');
const dgram = require('node:dgram');
const dns = require('node:dns');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isLocalHost, isLoopbackAddress } = require('./no-egress');

describe('disposable test egress fence', () => {
    test('permits local database/service addresses and rejects other hosts', () => {
        expect(isLocalHost('127.0.0.1')).toBe(true);
        expect(isLocalHost('localhost')).toBe(true);
        expect(isLocalHost('::1')).toBe(true);
        expect(isLocalHost('192.0.2.1')).toBe(false);
        expect(isLocalHost('example.com')).toBe(false);
        expect(isLoopbackAddress('127.0.0.1')).toBe(true);
        expect(isLoopbackAddress('localhost')).toBe(false);
        expect(isLoopbackAddress('192.0.2.1')).toBe(false);
    });

    test('allows loopback HTTP and rejects external DNS, TCP, UDP, HTTP and fetch calls before connecting', async () => {
        const server = http.createServer((_request, response) => response.end('local'));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${server.address().port}/health`;
        const attemptsPath = path.join(os.tmpdir(), `easymod-egress-test-${process.pid}-${crypto.randomUUID()}.txt`);
        const priorAttemptsPath = process.env.LAB_EGRESS_ATTEMPTS_PATH;
        try {
            expect(await (await fetch(url)).text()).toBe('local');
            process.env.LAB_EGRESS_ATTEMPTS_PATH = attemptsPath;
            await expect(fetch('https://example.com/')).rejects.toMatchObject({ code: 'EACCES' });
            expect(fs.readFileSync(attemptsPath, 'utf8').trim()).toBe('fetch');
            await expect(fetch(url, { dispatcher: { dispatch() {} } })).rejects.toMatchObject({ code: 'EACCES' });
            expect(() => require('node:https').request('https://example.com/')).toThrow(/External network access is disabled/);
            expect(() => http.request({ hostname: '127.0.0.1', port: 80, lookup: (_host, _options, callback) => callback(null, '192.0.2.1', 4) })).toThrow(/External network access is disabled/);
            expect(() => http.request({ hostname: 'localhost', port: 80, lookup: (_host, _options, callback) => callback(null, '192.0.2.1', 4) })).toThrow(/External network access is disabled/);
            await expect(dns.promises.resolve4('example.com')).rejects.toMatchObject({ code: 'EACCES' });
            await expect(dns.promises.resolve4('localhost')).rejects.toMatchObject({ code: 'EACCES' });
            await expect(dns.promises.lookupService('127.0.0.1', 80)).rejects.toMatchObject({ code: 'EACCES' });
            await new Promise(resolve => dns.resolve4('localhost', error => {
                expect(error).toMatchObject({ code: 'EACCES' });
                resolve();
            }));
            const udp = dgram.createSocket('udp4');
            try {
                expect(() => udp.send(Buffer.from('blocked'), 53, '192.0.2.1')).toThrow(/External network access is disabled/);
                expect(() => udp.connect(53, '192.0.2.1')).toThrow(/External network access is disabled/);
                expect(() => udp.send(Buffer.from('blocked'), 53, 'localhost')).toThrow(/External network access is disabled/);
            } finally {
                udp.close();
            }
        } finally {
            if (priorAttemptsPath === undefined) delete process.env.LAB_EGRESS_ATTEMPTS_PATH;
            else process.env.LAB_EGRESS_ATTEMPTS_PATH = priorAttemptsPath;
            try { fs.unlinkSync(attemptsPath); } catch (_) { }
            await new Promise(resolve => server.close(resolve));
        }
    });
});
