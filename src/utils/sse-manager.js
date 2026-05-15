/**
 * SSE Manager — in-process pub/sub for Server-Sent Events.
 *
 * Keeps a registry of open SSE response objects keyed by shopId.
 * Conversation controller calls emit() after creating messages or
 * toggling HITL, and every connected agent browser tab receives
 * the event without polling.
 *
 * No external dependencies — plain Express res.write().
 */

// Map<shopId, Set<res>>
const connections = new Map();

/**
 * Register an SSE response object for a shop.
 * Call once per connected client.
 */
function register(shopId, res) {
    if (!connections.has(shopId)) {
        connections.set(shopId, new Set());
    }
    connections.get(shopId).add(res);
}

/**
 * Remove a response from the registry (called on request close).
 */
function unregister(shopId, res) {
    const conns = connections.get(shopId);
    if (!conns) return;
    conns.delete(res);
    if (conns.size === 0) connections.delete(shopId);
}

/**
 * Emit a named SSE event to all connections for a shop.
 * Stale connections that fail to write are silently removed.
 */
function emit(shopId, event, data) {
    const conns = connections.get(shopId);
    if (!conns || conns.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of conns) {
        try {
            res.write(payload);
        } catch (_) {
            // Client disconnected without triggering close event
            conns.delete(res);
        }
    }
}

module.exports = { register, unregister, emit };
