'use strict';

const dns = require('dns').promises;
const https = require('https');
const net = require('net');

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 2;
const ALLOWED_MIME_TYPES = new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
]);
const META_HOST_SUFFIXES = [
    '.fbcdn.net',
    '.fbsbx.com',
];

function ipv4Number(value) {
    const octets = value.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return null;
    }
    return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function inIpv4Cidr(value, base, bits) {
    const ip = ipv4Number(value);
    const network = ipv4Number(base);
    if (ip === null || network === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (network & mask);
}

function isPublicIp(address) {
    const family = net.isIP(address);
    if (family === 4) {
        const blocked = [
            ['0.0.0.0', 8],
            ['10.0.0.0', 8],
            ['100.64.0.0', 10],
            ['127.0.0.0', 8],
            ['169.254.0.0', 16],
            ['172.16.0.0', 12],
            ['192.0.0.0', 24],
            ['192.0.2.0', 24],
            ['192.168.0.0', 16],
            ['198.18.0.0', 15],
            ['198.51.100.0', 24],
            ['203.0.113.0', 24],
            ['224.0.0.0', 4],
            ['240.0.0.0', 4],
        ];
        return !blocked.some(([base, bits]) => inIpv4Cidr(address, base, bits));
    }
    if (family === 6) {
        const normalized = address.toLowerCase().split('%')[0];
        if (normalized.startsWith('::ffff:')) {
            return isPublicIp(normalized.slice('::ffff:'.length));
        }
        return !(
            normalized === '::'
            || normalized === '::1'
            || /^(fc|fd)/.test(normalized)
            || /^(fe[89ab])/.test(normalized)
            || normalized.startsWith('ff')
            || normalized.startsWith('2001:db8')
        );
    }
    return false;
}

function configuredHosts(env = process.env) {
    const hosts = new Set(
        String(env.MEDIA_FETCH_ALLOWED_HOSTS || '')
            .split(',')
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean),
    );
    for (const name of ['BASE_URL', 'PUBLIC_BASE_URL']) {
        try {
            const url = new URL(env[name]);
            if (url.protocol === 'https:') hosts.add(url.hostname.toLowerCase());
        } catch (_) { /* optional URL */ }
    }
    return hosts;
}

function isAllowedHost(hostname, env = process.env) {
    const host = String(hostname).toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || net.isIP(host)) return false;
    if (META_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
    return configuredHosts(env).has(host);
}

function validateUrl(value, env = process.env) {
    let url;
    try {
        url = new URL(value);
    } catch (_) {
        throw new Error('Media URL is invalid');
    }
    if (url.protocol !== 'https:') throw new Error('Media URL must use HTTPS');
    if (url.username || url.password) throw new Error('Media URL credentials are forbidden');
    if (!isAllowedHost(url.hostname, env)) throw new Error('Media host is not allowlisted');
    return url;
}

async function resolvePublicAddress(hostname, lookup = dns.lookup) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error('Media host did not resolve');
    }
    if (addresses.some(({ address }) => !isPublicIp(address))) {
        throw new Error('Media host resolves to a non-public address');
    }
    return addresses[0];
}

function requestOnce(url, resolved, {
    maxBytes,
    timeoutMs,
    requestImpl = https.request,
}) {
    return new Promise((resolve, reject) => {
        let totalTimer;
        const finish = (callback, value) => {
            clearTimeout(totalTimer);
            callback(value);
        };
        const req = requestImpl(url, {
            method: 'GET',
            headers: {
                Accept: [...ALLOWED_MIME_TYPES].join(', '),
                'User-Agent': 'EasyModerator-MediaFetcher/1.0',
            },
            lookup: (_hostname, _options, callback) => {
                callback(null, resolved.address, resolved.family);
            },
            servername: url.hostname,
        }, (response) => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400) {
                response.resume();
                return finish(resolve, { redirect: response.headers.location || null });
            }
            if (status < 200 || status >= 300) {
                response.resume();
                return finish(reject, new Error(`Media fetch failed with status ${status}`));
            }

            const mimeType = String(response.headers['content-type'] || '')
                .split(';')[0]
                .trim()
                .toLowerCase();
            if (!ALLOWED_MIME_TYPES.has(mimeType)) {
                response.resume();
                return finish(reject, new Error('Media response MIME type is not allowed'));
            }
            const declaredLength = Number(response.headers['content-length']);
            if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
                response.resume();
                return finish(reject, new Error('Media response exceeds the size limit'));
            }

            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    response.destroy(new Error('Media response exceeds the size limit'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => finish(resolve, {
                buffer: Buffer.concat(chunks),
                mimeType,
            }));
            response.on('error', (error) => finish(reject, error));
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Media fetch connection timed out')));
        totalTimer = setTimeout(
            () => req.destroy(new Error('Media fetch total timeout exceeded')),
            timeoutMs,
        );
        req.on('error', (error) => finish(reject, error));
        req.end();
    });
}

async function safeFetchMedia(value, options = {}) {
    const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let current = validateUrl(value, options.env);

    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        const resolved = await resolvePublicAddress(current.hostname, options.lookup);
        const result = await requestOnce(current, resolved, {
            maxBytes,
            timeoutMs,
            requestImpl: options.requestImpl,
        });
        if (!result.redirect) return result;
        if (redirects === maxRedirects) throw new Error('Media redirect limit exceeded');
        current = validateUrl(new URL(result.redirect, current).toString(), options.env);
    }
    throw new Error('Media fetch failed');
}

module.exports = {
    ALLOWED_MIME_TYPES,
    safeFetchMedia,
    _private: {
        configuredHosts,
        inIpv4Cidr,
        isAllowedHost,
        isPublicIp,
        requestOnce,
        resolvePublicAddress,
        validateUrl,
    },
};
