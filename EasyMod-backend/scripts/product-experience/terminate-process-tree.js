'use strict';

const { spawnSync } = require('node:child_process');

const terminateProcessTree = childOrPid => {
    const pid = Number(typeof childOrPid === 'number' ? childOrPid : childOrPid?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return 'NO_PROCESS_ID';

    if (process.platform === 'win32') {
        const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 5000,
        });
        if (!result.error && result.status === 0) return 'PROCESS_TREE_TERMINATED';
        try {
            if (typeof childOrPid?.kill === 'function') childOrPid.kill();
            return 'DIRECT_CHILD_KILL_FALLBACK';
        } catch (_) {
            return 'PROCESS_TREE_TERMINATION_FAILED';
        }
    }

    try {
        process.kill(-pid, 'SIGKILL');
        return 'PROCESS_GROUP_TERMINATED';
    } catch (_) {
        try {
            if (typeof childOrPid?.kill === 'function') childOrPid.kill('SIGKILL');
            return 'DIRECT_CHILD_KILL_FALLBACK';
        } catch (_) {
            return 'PROCESS_TREE_TERMINATION_FAILED';
        }
    }
};

module.exports = { terminateProcessTree };
