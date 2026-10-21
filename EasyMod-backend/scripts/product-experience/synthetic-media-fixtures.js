'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MEDIA_ROOT = path.resolve(__dirname, '../../../docs/ai/product-experience-v1-2/media/synthetic');
const MANIFEST_PATH = path.join(MEDIA_ROOT, 'SYNTHETIC_MEDIA_PROVENANCE.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const readManifest = () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest.schemaVersion !== 2 || manifest.synthetic !== true || manifest.sourceDatasetPhotosProvided !== false) {
        throw new Error('Synthetic media manifest provenance is invalid.');
    }
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 4
        || manifest.assets.some(asset => !/^[a-z0-9-]+$/.test(asset.id)
            || path.basename(asset.file) !== asset.file
            || asset.mimeType !== 'image/png'
            || !/^[a-f0-9]{64}$/.test(asset.sha256))) {
        throw new Error('Synthetic media asset manifest is invalid.');
    }
    return Object.freeze({ ...manifest, assets: Object.freeze(manifest.assets.map(asset => Object.freeze(asset))) });
};

const MANIFEST = readManifest();
const ASSET_BY_ID = new Map(MANIFEST.assets.map(asset => [asset.id, asset]));
const ASSET_BY_SHA256 = new Map(MANIFEST.assets.map(asset => [asset.sha256, asset]));

const loadSyntheticMediaFixture = assetId => {
    const asset = ASSET_BY_ID.get(assetId);
    if (!asset) throw new Error('Synthetic media fixture is not registered.');
    const filePath = path.resolve(MEDIA_ROOT, asset.file);
    if (path.dirname(filePath) !== MEDIA_ROOT) throw new Error('Synthetic media path is outside its fixture directory.');
    const buffer = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (buffer.length > MAX_IMAGE_BYTES || buffer.length !== asset.bytes || sha256 !== asset.sha256
        || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Synthetic media fixture failed its integrity check.');
    }
    return Object.freeze({
        assetId: asset.id,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        bytes: buffer.length,
        sha256,
        dataUrl: `data:${asset.mimeType};base64,${buffer.toString('base64')}`,
    });
};

const isRegisteredSyntheticRaster = ({ buffer, mimeType }) => {
    if (!Buffer.isBuffer(buffer) || mimeType !== 'image/png') return false;
    const asset = ASSET_BY_SHA256.get(crypto.createHash('sha256').update(buffer).digest('hex'));
    return Boolean(asset && asset.bytes === buffer.length);
};

module.exports = {
    loadSyntheticMediaFixture,
    isRegisteredSyntheticRaster,
    SYNTHETIC_MEDIA_MANIFEST: MANIFEST,
};
