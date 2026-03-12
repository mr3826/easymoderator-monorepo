/**
 * Global XSS sanitization middleware.
 * Applied to req.body after JSON parsing.
 * Strips script tags, event handlers, and javascript: URIs from all string values.
 * Does NOT reject — sanitizes in-place so valid content still passes through.
 */

const XSS_PATTERNS = [
    // <script> blocks (including content)
    [/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''],
    // Inline event handlers: onclick=, onload=, onerror=, etc.
    [/\bon\w{1,30}\s*=\s*["']?[^"'>]*/gi, ''],
    // javascript: URI scheme
    [/javascript\s*:/gi, ''],
    // data: URI (common XSS vector)
    [/data\s*:\s*text\/html/gi, ''],
    // vbscript: URI
    [/vbscript\s*:/gi, ''],
    // Remaining HTML tags (after script stripping)
    [/<[^>]+>/g, '']
];

/**
 * Recursively sanitize a value.
 * Strings: apply XSS patterns.
 * Objects/Arrays: recurse into each field.
 * Other primitives: pass through unchanged.
 */
function sanitize(value) {
    if (typeof value === 'string') {
        return XSS_PATTERNS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), value);
    }
    if (Array.isArray(value)) {
        return value.map(sanitize);
    }
    if (value !== null && typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value)) {
            result[key] = sanitize(value[key]);
        }
        return result;
    }
    return value;
}

module.exports = function xssSanitize(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitize(req.body);
    }
    next();
};
