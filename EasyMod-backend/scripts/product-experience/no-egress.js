'use strict';

// API-level egress guard for disposable integration runs. It is not an OS firewall.
const net = require('node:net');
const fs = require('node:fs');
const dns = require('node:dns');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');

const isLocalHost = (value) => {
    const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === 'localhost.') return true;
    if (host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1') return true;
    if (net.isIP(host) === 4) return host.startsWith('127.');
    return false;
};

const isLoopbackAddress = (value) => {
    const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
    return net.isIP(host) !== 0 && isLocalHost(host);
};

const blocked = (api) => {
    const attemptsPath = process.env.LAB_EGRESS_ATTEMPTS_PATH;
    if (attemptsPath) fs.appendFileSync(attemptsPath, `${api || 'unknown'}\n`, 'utf8');
    return Object.assign(new Error('External network access is disabled for this local test.'), { code: 'EACCES' });
};

const connectionOptions = (args) => {
    const first = args[0];
    return first && typeof first === 'object' ? first : null;
};

const connectionHost = (args) => {
    const options = connectionOptions(args);
    if (options) return options.path ? null : options.host || options.hostname || 'localhost';
    if (typeof args[0] === 'string') return null;
    return args[1] || 'localhost';
};

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
    const options = connectionOptions(args);
    if (options?.path) return originalConnect.apply(this, args);
    if (!isLocalHost(connectionHost(args)) || (options && typeof options.lookup === 'function')) {
        const error = blocked('net.Socket.connect');
        process.nextTick(() => this.emit('error', error));
        return this;
    }
    return originalConnect.apply(this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...args) {
    if (!isLocalHost(hostname)) {
        const callback = args.find(value => typeof value === 'function');
        const error = blocked('dns.lookup');
        if (callback) return process.nextTick(() => callback(error));
        return Promise.reject(error);
    }
    return originalLookup.call(this, hostname, ...args);
};

const resolverMethods = [
    'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
    'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv',
    'resolveTxt', 'reverse',
];
for (const method of resolverMethods) {
    if (typeof dns[method] !== 'function') continue;
    dns[method] = function guardedResolve(_hostname, ...args) {
        const callback = args.find(value => typeof value === 'function');
        const error = blocked(`dns.${method}`);
        if (callback) return process.nextTick(() => callback(error));
        throw error;
    };
}

dns.lookupService = function guardedLookupService(_address, _port, callback) {
    const error = blocked('dns.lookupService');
    if (typeof callback === 'function') return process.nextTick(() => callback(error));
    throw error;
};

const promiseDns = dns.promises;
if (promiseDns) {
    for (const method of ['lookup', ...resolverMethods, 'lookupService']) {
        if (typeof promiseDns[method] !== 'function') continue;
        if (method === 'lookup') {
            const original = promiseDns[method].bind(promiseDns);
            promiseDns[method] = function guardedPromiseLookup(hostname, ...args) {
        if (!isLocalHost(hostname)) return Promise.reject(blocked('dns.promises.lookup'));
                return original(hostname, ...args);
            };
        } else {
            promiseDns[method] = function guardedPromiseResolve() {
                return Promise.reject(blocked(`dns.promises.${method}`));
            };
        };
    }
}

const originalDgramConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function guardedDgramConnect(port, address, ...args) {
    if (!isLoopbackAddress(address)) throw blocked('dgram.connect');
    return originalDgramConnect.call(this, port, address, ...args);
};

const originalDgramSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedDgramSend(...args) {
    const target = typeof args[2] === 'string'
        ? args[2]
        : typeof args[4] === 'string'
            ? args[4]
            : this.remoteAddress()?.address;
    if (!isLoopbackAddress(target)) throw blocked('dgram.send');
    return originalDgramSend.apply(this, args);
};

const httpHost = (args) => {
    const target = args[0];
    if (target instanceof URL || typeof target === 'string') {
        try { return new URL(target).hostname; } catch (_) { return null; }
    }
    if (target && typeof target === 'object') return target.hostname || target.host || 'localhost';
    return null;
};

const hasUnsafeHttpOptions = (args, client) => args.some(value => {
    if (!value || typeof value !== 'object' || value instanceof URL) return false;
    if (typeof value.lookup === 'function') return true;
    return value.agent !== undefined && value.agent !== false && value.agent !== client.globalAgent;
});

for (const client of [http, https]) {
    const originalRequest = client.request;
    client.request = function guardedRequest(...args) {
        if (!isLocalHost(httpHost(args)) || hasUnsafeHttpOptions(args, client)) throw blocked(`${client === http ? 'http' : 'https'}.request`);
        return originalRequest.apply(this, args);
    };
}

if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function guardedFetch(input, init) {
        let url;
        try { url = new URL(typeof input === 'string' ? input : input.url); } catch (_) { return Promise.reject(blocked('fetch')); }
        if (!['http:', 'https:'].includes(url.protocol) || !isLocalHost(url.hostname)
            || init?.dispatcher || init?.agent) return Promise.reject(blocked('fetch'));
        return originalFetch.call(this, input, init);
    };
}

module.exports = { isLocalHost, isLoopbackAddress };
