'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_ROOT = path.resolve(__dirname, '../../../docs/ai/product-experience-v1-3/media/genuine');
const MANIFEST_PATH = path.join(MEDIA_ROOT, 'Genuine_Photo_Manifest.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LICENSES = new Set(['CC BY 4.0', 'CC BY-SA 4.0', 'CC0 1.0']);
const PUBLIC_MEDIA_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

const validUrl = (value, hosts) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && hosts.has(parsed.hostname);
    } catch {
        return false;
    }
};

const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

const validExpected = value => value && typeof value === 'object'
    && ['category', 'dominantColor'].every(field => Array.isArray(value[field])
        && value[field].length > 0 && value[field].length <= 5
        && value[field].every(term => typeof term === 'string' && /^[a-z -]{2,32}$/i.test(term)));

const readManifest = () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.classification !== 'genuine-public-product-photographs'
        || manifest.sourceDatasetPhotosProvided !== false || !Array.isArray(manifest.assets)
        || manifest.assets.length !== 3) {
        throw new Error('Genuine photo manifest provenance is invalid.');
    }
    const ids = new Set();
    const files = new Set();
    for (const asset of manifest.assets) {
        if (!/^[a-z0-9-]{1,64}$/.test(asset.id) || ids.has(asset.id)
            || path.basename(asset.file) !== asset.file || files.has(asset.file)
            || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES
            || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.mimeType !== 'image/jpeg'
            || !validUrl(asset.sourcePageUrl, new Set(['commons.wikimedia.org']))
            || !validUrl(asset.directDownloadUrl, PUBLIC_MEDIA_HOSTS)
            || !LICENSES.has(asset.license) || typeof asset.author !== 'string' || !asset.author.trim()
            || typeof asset.title !== 'string' || !asset.title.trim()
            || !validExpected(asset.expectedVisible) || asset.visibleHumanSubject !== false) {
            throw new Error('Genuine photo asset provenance is invalid.');
        }
        ids.add(asset.id);
        files.add(asset.file);
    }
    return Object.freeze({ ...manifest, assets: Object.freeze(manifest.assets.map(asset => Object.freeze(asset))) });
};

const MANIFEST = readManifest();
const ASSET_BY_ID = new Map(MANIFEST.assets.map(asset => [asset.id, asset]));
const ASSET_BY_SHA256 = new Map(MANIFEST.assets.map(asset => [asset.sha256, asset]));

const loadGenuinePhotoFixture = assetId => {
    const asset = ASSET_BY_ID.get(assetId);
    if (!asset) throw new Error('Genuine photo fixture is not registered.');
    const filePath = path.resolve(MEDIA_ROOT, asset.file);
    if (path.dirname(filePath) !== MEDIA_ROOT) throw new Error('Genuine photo path is outside its fixture directory.');
    const buffer = fs.readFileSync(filePath);
    if (buffer.length !== asset.bytes || buffer.length > MAX_IMAGE_BYTES || hash(buffer) !== asset.sha256
        || buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') {
        throw new Error('Genuine photo fixture failed its integrity check.');
    }
    return Object.freeze({
        assetId: asset.id,
        file: asset.file,
        bytes: buffer.length,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        sourcePageUrl: asset.sourcePageUrl,
        directDownloadUrl: asset.directDownloadUrl,
        title: asset.title,
        author: asset.author,
        license: asset.license,
        licenseUrl: asset.licenseUrl,
        localChange: asset.localChange,
        expectedVisible: asset.expectedVisible,
        dataUrl: `data:${asset.mimeType};base64,${buffer.toString('base64')}`,
    });
};

const isRegisteredGenuineRaster = ({ buffer, mimeType }) => {
    if (!Buffer.isBuffer(buffer) || mimeType !== 'image/jpeg') return false;
    const asset = ASSET_BY_SHA256.get(hash(buffer));
    return Boolean(asset && asset.bytes === buffer.length);
};

module.exports = { loadGenuinePhotoFixture, isRegisteredGenuineRaster, GENUINE_PHOTO_MANIFEST: MANIFEST };
