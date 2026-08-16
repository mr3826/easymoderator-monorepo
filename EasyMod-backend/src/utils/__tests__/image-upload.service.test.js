'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');

process.env.EASYMOD_UPLOAD_ROOT = path.resolve(__dirname, '../../../..', '.test-uploads');

const {
    parseDataUrl,
    saveDataUrlImage,
    UPLOAD_ROOT,
} = require('../image-upload.service');

// A 1x1 PNG, so the bytes written are a real image rather than filler.
const PNG_1PX_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX_B64}`;

const SHOP_ID = 'shop-test-image-upload';
const SUBDIR = 'product-images';
const MAX_BYTES = 5 * 1024 * 1024;

const save = (overrides = {}) =>
    saveDataUrlImage({
        dataUrl: PNG_DATA_URL,
        shopId: SHOP_ID,
        subdir: SUBDIR,
        maxBytes: MAX_BYTES,
        ...overrides,
    });

describe('image-upload.service', () => {
    afterAll(async () => {
        // Only ever removes the directory this test created.
        await fs.rm(path.join(UPLOAD_ROOT, SUBDIR, SHOP_ID), { recursive: true, force: true });
    });

    describe('parseDataUrl', () => {
        it('extracts the mime type and decodes the payload', () => {
            const parsed = parseDataUrl(PNG_DATA_URL);
            expect(parsed.mimeType).toBe('image/png');
            expect(parsed.buffer).toBeInstanceOf(Buffer);
            // PNG magic number — proves we decoded rather than stored the text.
            expect(parsed.buffer.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        });

        it('returns null for anything that is not a base64 data URL', () => {
            expect(parseDataUrl('https://example.com/a.png')).toBeNull();
            expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
            expect(parseDataUrl(undefined)).toBeNull();
            expect(parseDataUrl(12345)).toBeNull();
        });
    });

    describe('saveDataUrlImage', () => {
        it('writes the file and returns a public path under the shop scope', async () => {
            const result = await save();

            expect(result.mimeType).toBe('image/png');
            expect(result.bytes).toBeGreaterThan(0);
            expect(result.publicPath).toMatch(
                new RegExp(`^/uploads/${SUBDIR}/${SHOP_ID}/\\d+-[0-9a-f-]{36}\\.png$`)
            );

            const onDisk = path.join(UPLOAD_ROOT, result.publicPath.replace('/uploads/', ''));
            await expect(fs.access(onDisk)).resolves.toBeUndefined();
            expect((await fs.readFile(onDisk)).length).toBe(result.bytes);
        });

        it('never lets a caller influence the filename', async () => {
            // Even with a hostile shop id rejected below, the legitimate path
            // must contain no caller-supplied token beyond the shop scope.
            const { publicPath } = await save();
            const fileName = path.basename(publicPath);
            expect(fileName).not.toContain('..');
            expect(fileName).not.toContain('/');
            expect(fileName).not.toContain('\\');
        });

        it('rejects a mime type outside the allowlist', async () => {
            await expect(
                save({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
            ).rejects.toThrow(/Unsupported image type/);
        });

        it('rejects a payload over the byte cap, measured after decoding', async () => {
            const big = Buffer.alloc(64 * 1024, 1).toString('base64');
            await expect(
                save({ dataUrl: `data:image/png;base64,${big}`, maxBytes: 1024 })
            ).rejects.toThrow(/exceeds the/);
        });

        it('rejects an empty image', async () => {
            await expect(save({ dataUrl: 'data:image/png;base64,' })).rejects.toThrow(
                /base64 data URL/
            );
        });

        it('rejects a shop id that could escape the upload root', async () => {
            for (const hostile of ['../..', 'a/../../b', '/etc', 'a\\b', '', null]) {
                await expect(save({ shopId: hostile })).rejects.toThrow(/Invalid shop scope/);
            }
        });

        it('does not write anything outside the upload root', async () => {
            const { publicPath } = await save();
            const resolved = path.resolve(path.join(UPLOAD_ROOT, publicPath.replace('/uploads/', '')));
            expect(resolved.startsWith(UPLOAD_ROOT + path.sep)).toBe(true);
            expect(resolved.startsWith(os.tmpdir())).toBe(false);
        });
    });
});
