/**
 * P2-2: Per-route request timeouts (use after global timeout handler in app.js)
 * Global default is 30s; use timeoutRead for read-heavy routes (5s), timeoutWrite for writes (10s).
 */
const timeout = require('express-timeout-handler');

const timeoutRead = timeout.set(5000);
const timeoutWrite = timeout.set(10000);

module.exports = {
    timeoutRead,
    timeoutWrite
};
