/**
 * Shared storage for images that arrive as base64 data URLs.
 *
 * Why data URLs and not multipart: this is the transport the codebase already
 * uses for the Messenger attachment path (`conversation.controller.js`), and it
 * needs no multipart dependency. `config.bodySizeLimit` is 35mb, so callers
 * should accept ONE image per request — a batch of five 5MB images encodes to
 * ~33MB and sits right on that limit.
 *
 * Files land in `<repo>/uploads/<subdir>/<shopId>/`, which is the
 * `backend_uploads` Docker volume in production (docker-compose.prod.yml) and is
 * served read-only by `app.js` at `/uploads`. The uploads volume is included in
 * the nightly backup (.github/workflows/backup.yml).
 *
 * Path safety rests on two rules, both enforced below:
 *   1. The filename is generated here from a UUID. No caller-supplied filename
 *      is ever accepted, so there is nothing to traverse with.
 *   2. `shopId` is the only caller-supplied path component, so it is checked
 *      against a strict character allowlist before it is joined.
 * The final resolved path is re-checked against the upload root as a backstop.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('./AppError');
const { resolvePublicAssetOrigin } = require('../config/origins');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

// Deliberately narrow: `data:<mime>;base64,<payload>`. A data URL with
// parameters (`;charset=`) or URL-encoding rather than base64 is rejected
// outright instead of being coaxed into something parseable.
const DATA_URL_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/;

// Extensions are looked up from the MIME type, never taken from the caller.
const IMAGE_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parse a base64 data URL into its MIME type and decoded bytes.
 * Returns null when the value is not a data URL — callers decide whether that
 * is an error or simply "nothing to store".
 */
function parseDataUrl(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(DATA_URL_RE);
    if (!match) return null;
    return {
        mimeType: match[1].toLowerCase(),
        buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
    };
}

/**
 * Absolute base URL for building public links to stored files.
 *
 * Prefers explicit configuration; falls back to the request's own host so local
 * development works without env setup. Meta will not fetch an attachment over
 * plain HTTP, so callers that hand URLs to Meta must assert HTTPS themselves.
 */
function publicBaseUrl(req) {
    return resolvePublicAssetOrigin(req);
}

/**
 * Store one base64 image and return its public `/uploads/...` path.
 *
 * @param {object}  opts
 * @param {string}  opts.dataUrl       `data:image/png;base64,...`
 * @param {string}  opts.shopId        tenant scope; becomes a directory name
 * @param {string}  opts.subdir        bucket under /uploads, e.g. 'product-images'
 * @param {object} [opts.allowedTypes] mime → extension map; defaults to IMAGE_TYPES
 * @param {number}  opts.maxBytes      reject anything larger, before writing
 * @returns {Promise<{publicPath: string, mimeType: string, bytes: number}>}
 */
async function saveDataUrlImage({ dataUrl, shopId, subdir, allowedTypes = IMAGE_TYPES, maxBytes }) {
    if (!SAFE_PATH_SEGMENT.test(String(shopId || ''))) {
        // Not a user-facing input — reaching here means a caller passed
        // something other than an authenticated shop id.
        throw new AppError('Invalid shop scope for upload', 400, 'VALIDATION_ERROR');
    }
    if (!SAFE_PATH_SEGMENT.test(String(subdir || ''))) {
        throw new AppError('Invalid upload bucket', 500, 'INTERNAL_ERROR');
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
        throw new AppError('Image must be a base64 data URL', 400, 'VALIDATION_ERROR');
    }

    const ext = allowedTypes[parsed.mimeType];
    if (!ext) {
        throw new AppError(
            `Unsupported image type. Allowed: ${Object.keys(allowedTypes).join(', ')}`,
            400,
            'VALIDATION_ERROR'
        );
    }
    // Check the decoded length, not the base64 length — the caller's limit is
    // about the bytes we store, and base64 inflates by ~33%.
    if (parsed.buffer.length > maxBytes) {
        throw new AppError(
            `Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`,
            400,
            'VALIDATION_ERROR'
        );
    }
    if (parsed.buffer.length === 0) {
        throw new AppError('Image is empty', 400, 'VALIDATION_ERROR');
    }

    const uploadDir = path.join(UPLOAD_ROOT, subdir, shopId);
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const absolutePath = path.join(uploadDir, fileName);

    // Backstop: both components above are already allowlisted, so this can only
    // fire if one of those guards is later loosened.
    if (!path.resolve(absolutePath).startsWith(UPLOAD_ROOT + path.sep)) {
        throw new AppError('Resolved upload path escaped the upload root', 500, 'INTERNAL_ERROR');
    }

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(absolutePath, parsed.buffer);

    return {
        publicPath: `/uploads/${subdir}/${shopId}/${fileName}`,
        mimeType: parsed.mimeType,
        bytes: parsed.buffer.length,
        // Internal cleanup handle. Callers should never expose this path.
        absolutePath,
    };
}

module.exports = {
    parseDataUrl,
    publicBaseUrl,
    saveDataUrlImage,
    IMAGE_TYPES,
    UPLOAD_ROOT,
};
