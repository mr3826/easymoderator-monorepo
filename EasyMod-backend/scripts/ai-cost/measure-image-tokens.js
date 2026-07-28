#!/usr/bin/env node
'use strict';

/**
 * Provider-reported image tokenization measurement.
 *
 * Gemini bills image inputs as tokens, and the count depends on the image's
 * pixel dimensions (not its content). This generates solid-colour PNGs at the
 * resolutions Messenger/Instagram actually deliver and asks Gemini's free
 * `countTokens` endpoint how many tokens each costs.
 *
 * No content is generated and nothing is billed. Read-only measurement.
 *
 *   node scripts/ai-cost/measure-image-tokens.js [--json]
 */

require('dotenv').config();
const zlib = require('zlib');

const GEMINI_MODEL = process.env.LLM_GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';

// ── Minimal PNG encoder (solid colour, 8-bit RGB) ───────────────────────────
function crc32(buf) {
    let c;
    const table = crc32.table || (crc32.table = (() => {
        const t = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c;
        }
        return t;
    })());
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function makePng(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // colour type: truecolour RGB
    // 10,11,12 = compression/filter/interlace = 0

    const rowBytes = width * 3;
    const raw = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y++) {
        const off = y * (rowBytes + 1);
        raw[off] = 0; // filter: none
        for (let x = 0; x < width; x++) {
            const p = off + 1 + x * 3;
            raw[p] = (x * 7) & 0xff;
            raw[p + 1] = (y * 5) & 0xff;
            raw[p + 2] = ((x + y) * 3) & 0xff;
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Measurement ─────────────────────────────────────────────────────────────
async function countImageTokens(png) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set — cannot obtain provider-reported image tokens');

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:countTokens?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }],
                }],
            }),
            signal: AbortSignal.timeout(60000),
        },
    );
    if (!res.ok) throw new Error(`countTokens ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.totalTokens;
}

const RESOLUTIONS = [
    { label: '384x384 (Gemini single-tile ceiling)', w: 384, h: 384 },
    { label: '640x640 (compressed thumbnail)', w: 640, h: 640 },
    { label: '720x960 (Messenger typical portrait)', w: 720, h: 960 },
    { label: '1080x1440 (phone camera portrait)', w: 1080, h: 1440 },
    { label: '1600x1200 (uncompressed upload)', w: 1600, h: 1200 },
];

async function main() {
    const out = { measuredAt: new Date().toISOString(), model: GEMINI_MODEL, results: [] };
    for (const r of RESOLUTIONS) {
        const png = makePng(r.w, r.h);
        let tokens = null;
        let error = null;
        try {
            tokens = await countImageTokens(png);
        } catch (err) {
            error = err.message;
        }
        out.results.push({ ...r, pngBytes: png.length, tokens, error, measurementSource: tokens ? 'provider_reported' : 'failed' });
        if (!process.argv.includes('--json')) {
            console.log(`  ${r.label.padEnd(42)} ${tokens != null ? `${String(tokens).padStart(5)} tokens` : `FAILED: ${error}`}`);
        }
    }
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
