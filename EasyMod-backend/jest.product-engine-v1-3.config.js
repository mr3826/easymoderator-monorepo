'use strict';

const fs = require('node:fs');
const path = require('node:path');
const base = require('./jest.config');

const engineRoot = path.resolve(process.env.LAB_ENGINE_ROOT || path.join(__dirname));
if (!fs.existsSync(path.join(engineRoot, 'src', 'modules', 'ai', 'intent-router.service.js'))
    || !fs.existsSync(path.join(engineRoot, 'src', 'modules', 'ai', 'grounding', 'outbound-grounding.gate.js'))) {
    throw new Error('LAB_ENGINE_ROOT does not identify a complete EasyModerator backend source tree.');
}

module.exports = {
    ...base,
    rootDir: __dirname,
    moduleNameMapper: {
        '.*/jobs/message-queue$': '<rootDir>/tests/__mocks__/message-queue.js',
        '^src/(.*)$': path.join(engineRoot, 'src', '$1'),
    },
};
