'use strict';

const fs = require('fs/promises');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'probe-test-secret';
process.env.PUBLIC_ASSET_URL = 'https://api.easymod.tech';
process.env.PUBLIC_BASE_URL = 'https://api.easymod.tech';
process.env.EASYMOD_UPLOAD_ROOT = path.resolve(__dirname, '../../.probe-test-uploads');

const {
    decodeRenderedEnvValue,
    mintProbeAttachmentUrl,
    parseAttachmentStorageKey,
    runAttachmentTrace,
} = require('../production-db-auth-probe');
const {
    absolutePathForKey,
    recoverStorageKeyFromLegacyUrl,
} = require('../../src/modules/conversation/attachment-storage');

const traceMessageId = 'historical-message-1';
const traceShopId = 'shop-1';

afterAll(async () => {
    await fs.rm(process.env.EASYMOD_UPLOAD_ROOT, { recursive: true, force: true });
});

describe('production DB auth probe environment decoding', () => {
    test('decodes legacy JSON-quoted values without source-tree imports', () => {
        expect(decodeRenderedEnvValue(JSON.stringify('postgres://user:pass@db/easymod_prod')))
            .toBe('postgres://user:pass@db/easymod_prod');
    });

    test('preserves Docker-native values', () => {
        expect(decodeRenderedEnvValue('postgres://user:pass@db/easymod_prod'))
            .toBe('postgres://user:pass@db/easymod_prod');
    });

    test('preserves malformed quoted values so the probe fails closed', () => {
        const malformed = '"postgres://user:pass@db/easymod_prod';
        expect(decodeRenderedEnvValue(malformed)).toBe(malformed);
    });

    test('mints probe URLs without exposing their signed value in trace fields', () => {
        expect(parseAttachmentStorageKey('shop-1/photo.png')).toEqual({
            shopId: 'shop-1',
            fileName: 'photo.png',
        });
        expect(parseAttachmentStorageKey('shop-1/../photo.png')).toBeNull();
        const url = mintProbeAttachmentUrl({
            shopId: 'shop-1',
            fileName: 'photo.png',
            baseUrl: 'https://api.easymod.tech',
            expires: 1788891300,
        });
        expect(url).toMatch(/^https:\/\/api\.easymod\.tech\/uploads\/conversation-attachments\/shop-1\/photo\.png\?/);
        expect(new URL(url).searchParams.get('signature')).toMatch(/^[a-f0-9]{64}$/);
    });

    test('recovers a legacy key and verifies the URL returned by the messages API', async () => {
        const oldUrl = mintProbeAttachmentUrl({
            shopId: traceShopId,
            fileName: 'historical.png',
            baseUrl: 'https://api.easymod.tech',
            expires: Math.floor(Date.now() / 1000) - 60,
        });
        const applicationUrl = mintProbeAttachmentUrl({
            shopId: traceShopId,
            fileName: 'historical.png',
            baseUrl: 'https://api.easymod.tech',
            expires: Math.floor(Date.now() / 1000) + 900,
        });
        expect(recoverStorageKeyFromLegacyUrl(oldUrl, { expectedShopId: traceShopId }))
            .toBe(`${traceShopId}/historical.png`);
        const attachmentPath = absolutePathForKey(`${traceShopId}/historical.png`);
        await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
        await fs.writeFile(attachmentPath, Buffer.from('historical bytes'));

        const row = {
            message_id: traceMessageId,
            attachment_storage_key: null,
            image_url: oldUrl,
            file_url: oldUrl,
            metadata_text: JSON.stringify({ image_url: oldUrl }),
            shop_id: traceShopId,
        };
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce({ rows: [row] })
                .mockResolvedValueOnce({ rows: [{ metadata_text: row.metadata_text }] })
                .mockResolvedValue(undefined),
        };
        const response = (status, body, bytes) => ({
            status,
            ok: status >= 200 && status < 300,
            json: jest.fn().mockResolvedValue(body),
            arrayBuffer: jest.fn().mockResolvedValue(Buffer.from(bytes || '')),
            headers: { get: jest.fn().mockReturnValue('image/png') },
        });
        const originalFetch = global.fetch;
        const originalLog = console.log;
        const fetchCalls = [];
        global.fetch = jest.fn(async (url, options) => {
            fetchCalls.push({ url, options });
            if (url === oldUrl) return response(404);
            if (url === 'https://api.easymod.tech/api/conversation/c1/messages') {
                return response(200, {
                    data: {
                        messages: [{
                            id: traceMessageId,
                            metadata: { image_url: applicationUrl },
                        }],
                    },
                });
            }
            if (url === applicationUrl) return response(200, null, 'fresh bytes');
            throw new Error(`unexpected URL ${url}`);
        });
        console.log = jest.fn();

        process.env.PROBE_ATTACHMENT_TRACE = 'true';
        process.env.PROBE_ATTACHMENT_MESSAGE_ID = traceMessageId;
        process.env.PROBE_ATTACHMENT_SHOP_ID = traceShopId;
        process.env.PROBE_PUBLIC_ASSET_URL = 'https://api.easymod.tech';
        process.env.PROBE_MESSAGES_API_URL = 'https://api.easymod.tech/api/conversation/c1/messages';
        process.env.PROBE_AUTHORIZATION = 'Bearer probe-token';
        try {
            await expect(runAttachmentTrace(client)).resolves.toBe(true);
            expect(fetchCalls.map(({ url }) => url)).toEqual([oldUrl, process.env.PROBE_MESSAGES_API_URL, applicationUrl]);
            expect(fetchCalls[1].options.headers).toEqual({ Authorization: 'Bearer probe-token' });
            expect(console.log).toHaveBeenCalledWith('ATTACHMENT_TRACE_DURABLE_KEY_RECOVERED=YES');
            expect(console.log).toHaveBeenCalledWith('ATTACHMENT_TRACE_APPLICATION_URL_DIFFERENT=YES');
            expect(console.log).toHaveBeenCalledWith('ATTACHMENT_TRACE=PASS');
        } finally {
            global.fetch = originalFetch;
            console.log = originalLog;
            delete process.env.PROBE_ATTACHMENT_TRACE;
            delete process.env.PROBE_ATTACHMENT_MESSAGE_ID;
            delete process.env.PROBE_ATTACHMENT_SHOP_ID;
            delete process.env.PROBE_PUBLIC_ASSET_URL;
            delete process.env.PROBE_MESSAGES_API_URL;
            delete process.env.PROBE_AUTHORIZATION;
        }
    });
});
