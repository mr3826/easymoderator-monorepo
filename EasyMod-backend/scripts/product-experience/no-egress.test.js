'use strict';

const http = require('node:http');
const dgram = require('node:dgram');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isLocalHost, isLoopbackAddress, isAllowedGeminiEvaluationRequest } = require('./no-egress');
const { createEvaluationBudget, GEMINI_PRICE_SNAPSHOT, GEMINI_PRO_PRICE_SNAPSHOT } = require('./evaluation-budget');

const geminiRequest = (model = GEMINI_PRICE_SNAPSHOT.model, body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: { maxOutputTokens: 10, temperature: 0.3 },
})) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'test-only-not-a-credential' },
    body,
});
const captureBlockedEgress = async action => {
    const attemptsPath = path.join(os.tmpdir(), `easymod-egress-probe-${process.pid}-${crypto.randomUUID()}.txt`);
    const priorAttemptsPath = process.env.LAB_EGRESS_ATTEMPTS_PATH;
    process.env.LAB_EGRESS_ATTEMPTS_PATH = attemptsPath;
    try {
        await action();
        return fs.existsSync(attemptsPath)
            ? fs.readFileSync(attemptsPath, 'utf8').split(/\r?\n/).filter(Boolean)
            : [];
    } finally {
        if (priorAttemptsPath === undefined) delete process.env.LAB_EGRESS_ATTEMPTS_PATH;
        else process.env.LAB_EGRESS_ATTEMPTS_PATH = priorAttemptsPath;
        try { fs.unlinkSync(attemptsPath); } catch (_) { }
    }
};

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

    test('requires a one-use budget permit bound to the pinned model, request body, and exact key', async () => {
        const prior = process.env.EASYMOD_LIVE_GEMINI_EGRESS;
        const priorKey = process.env['EM-GEMINI-KEY'];
        try {
            process.env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            process.env['EM-GEMINI-KEY'] = 'test-only-not-a-credential';
            const request = geminiRequest();
            expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(false);

            const budget = createEvaluationBudget({ ceilingUsd: 1 });
            await budget.execute({
                operationId: 'egress-permit',
                model: GEMINI_PRICE_SNAPSHOT.model,
                inputTokenUpperBound: 5,
                maxOutputTokens: 10,
            }, async context => {
                expect(context.authorizeGeminiRequest({ ...request, redirect: 'follow' })).toBe(false);
                expect(context.authorizeGeminiRequest({
                    ...request,
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
                        generationConfig: { maxOutputTokens: 11, temperature: 0.3 },
                    }),
                })).toBe(false);
                expect(context.authorizeGeminiRequest({
                    ...request,
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: 'too large' }] }],
                        generationConfig: { maxOutputTokens: 10, temperature: 0.3 },
                    }),
                })).toBe(false);
                expect(context.authorizeGeminiRequest(request)).toBe(true);
                expect(isAllowedGeminiEvaluationRequest(request.url, { ...request, body: `${request.body} ` })).toBe(false);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(true);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(false);
                return { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } };
            });

            const wrongEndpoint = { ...request, url: request.url.replace('flash-lite', 'pro-preview') };
            expect(isAllowedGeminiEvaluationRequest(wrongEndpoint.url, wrongEndpoint)).toBe(false);
        } finally {
            if (prior === undefined) delete process.env.EASYMOD_LIVE_GEMINI_EGRESS;
            else process.env.EASYMOD_LIVE_GEMINI_EGRESS = prior;
            if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
            else process.env['EM-GEMINI-KEY'] = priorKey;
        }
    });

    test('permits a one-use Gemini Pro request only under the Pro-priced reservation', async () => {
        const prior = process.env.EASYMOD_LIVE_GEMINI_EGRESS;
        const priorKey = process.env['EM-GEMINI-KEY'];
        try {
            process.env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            process.env['EM-GEMINI-KEY'] = 'test-only-not-a-credential';
            const model = GEMINI_PRO_PRICE_SNAPSHOT.model;
            const request = geminiRequest(model);
            const budget = createEvaluationBudget({ ceilingUsd: 0.1, model });
            await budget.execute({
                operationId: 'pro-egress-permit', model, inputTokenUpperBound: 5, maxOutputTokens: 10,
            }, async context => {
                const wrongModel = { ...request, url: request.url.replace(model, GEMINI_PRICE_SNAPSHOT.model) };
                expect(context.authorizeGeminiRequest(wrongModel)).toBe(false);
                expect(context.authorizeGeminiRequest(request)).toBe(true);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(true);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(false);
                return { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } };
            });
            const unbudgetedPro = geminiRequest(model);
            expect(isAllowedGeminiEvaluationRequest(unbudgetedPro.url, unbudgetedPro)).toBe(false);
        } finally {
            if (prior === undefined) delete process.env.EASYMOD_LIVE_GEMINI_EGRESS;
            else process.env.EASYMOD_LIVE_GEMINI_EGRESS = prior;
            if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
            else process.env['EM-GEMINI-KEY'] = priorKey;
        }
    });

    test('keeps direct Gemini DNS and TCP closed even while live evaluation egress is enabled', async () => {
        const prior = process.env.EASYMOD_LIVE_GEMINI_EGRESS;
        const priorKey = process.env['EM-GEMINI-KEY'];
        try {
            process.env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            process.env['EM-GEMINI-KEY'] = 'test-only-not-a-credential';
            const blockedApis = await captureBlockedEgress(async () => {
                await expect(dns.promises.lookup('generativelanguage.googleapis.com')).rejects.toMatchObject({ code: 'EACCES' });
                const socket = net.createConnection({ host: 'generativelanguage.googleapis.com', port: 443 });
                const error = await new Promise(resolve => socket.once('error', resolve));
                expect(error).toMatchObject({ code: 'EACCES' });
                const directSocket = new net.Socket();
                const directErrorPromise = new Promise(resolve => directSocket.once('error', resolve));
                directSocket.connect({ host: '192.0.2.1', port: 443 });
                const directError = await directErrorPromise;
                expect(directError).toMatchObject({ code: 'EACCES' });
            });
            expect(blockedApis).toEqual(['dns.promises.lookup', 'dns.lookup', 'net.Socket.connect']);
        } finally {
            if (prior === undefined) delete process.env.EASYMOD_LIVE_GEMINI_EGRESS;
            else process.env.EASYMOD_LIVE_GEMINI_EGRESS = prior;
            if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
            else process.env['EM-GEMINI-KEY'] = priorKey;
        }
    });

    test('does not expose a socket-authorizing helper after a budget permit is consumed', async () => {
        const prior = process.env.EASYMOD_LIVE_GEMINI_EGRESS;
        const priorKey = process.env['EM-GEMINI-KEY'];
        try {
            process.env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            process.env['EM-GEMINI-KEY'] = 'test-only-not-a-credential';
            const budgetModule = require('./evaluation-budget');
            expect(budgetModule.runAuthorizedGeminiNetworkTransport).toBeUndefined();
            expect(budgetModule.isAuthorizedGeminiSocket).toBeUndefined();
            const request = geminiRequest();
            const budget = createEvaluationBudget({ ceilingUsd: 1 });
            await budget.execute({
                operationId: 'consumed-permit-cannot-open-socket',
                model: GEMINI_PRICE_SNAPSHOT.model,
                inputTokenUpperBound: 5,
                maxOutputTokens: 10,
            }, async context => {
                expect(context.authorizeGeminiRequest(request)).toBe(true);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(true);
                const blockedApis = await captureBlockedEgress(async () => {
                    await expect(dns.promises.lookup('generativelanguage.googleapis.com'))
                        .rejects.toMatchObject({ code: 'EACCES' });
                    const socket = net.createConnection({ host: 'generativelanguage.googleapis.com', port: 443 });
                    const error = await new Promise(resolve => socket.once('error', resolve));
                    expect(error).toMatchObject({ code: 'EACCES' });
                    const directSocket = new net.Socket();
                    const directErrorPromise = new Promise(resolve => directSocket.once('error', resolve));
                    directSocket.connect({ host: '192.0.2.1', port: 443 });
                    const directError = await directErrorPromise;
                    expect(directError).toMatchObject({ code: 'EACCES' });
                });
                expect(blockedApis).toEqual(['dns.promises.lookup', 'dns.lookup', 'net.Socket.connect']);
                return { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } };
            });
        } finally {
            if (prior === undefined) delete process.env.EASYMOD_LIVE_GEMINI_EGRESS;
            else process.env.EASYMOD_LIVE_GEMINI_EGRESS = prior;
            if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
            else process.env['EM-GEMINI-KEY'] = priorKey;
        }
    });

    test('refuses live permits when a custom price table is injected', async () => {
        const prior = process.env.EASYMOD_LIVE_GEMINI_EGRESS;
        const priorKey = process.env['EM-GEMINI-KEY'];
        try {
            process.env.EASYMOD_LIVE_GEMINI_EGRESS = '1';
            process.env['EM-GEMINI-KEY'] = 'test-only-not-a-credential';
            const request = geminiRequest();
            const budget = createEvaluationBudget({
                ceilingUsd: 1,
                rates: { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
            });
            await budget.execute({
                operationId: 'custom-pricing-cannot-open-egress',
                model: GEMINI_PRICE_SNAPSHOT.model,
                inputTokenUpperBound: 5,
                maxOutputTokens: 10,
            }, async context => {
                expect(context.authorizeGeminiRequest(request)).toBe(false);
                expect(isAllowedGeminiEvaluationRequest(request.url, request)).toBe(false);
                return { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } };
            });
        } finally {
            if (prior === undefined) delete process.env.EASYMOD_LIVE_GEMINI_EGRESS;
            else process.env.EASYMOD_LIVE_GEMINI_EGRESS = prior;
            if (priorKey === undefined) delete process.env['EM-GEMINI-KEY'];
            else process.env['EM-GEMINI-KEY'] = priorKey;
        }
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
