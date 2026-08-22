'use strict';

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '../../..');
const aiRoot = path.join(backendRoot, 'src', 'modules', 'ai');
const workerPath = path.join(backendRoot, 'src', 'jobs', 'message-worker.js');

const collectJavaScript = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScript(fullPath);
    return entry.name.endsWith('.js') ? [fullPath] : [];
});

const relativeSource = (file) => path.relative(backendRoot, file).replace(/\\/g, '/');

describe('AI mutation import boundary', () => {
    test('AI modules and the message worker do not import mutation services directly', () => {
        const files = [...collectJavaScript(aiRoot), workerPath];
        const forbidden = /require\(['"](?:\.\.\/)+(?:order|payment|delivery|customer|consent)\/[^'"]*(?:service|controller)\.js['"]\)/g;
        const violations = [];

        for (const file of files) {
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(forbidden)) {
                violations.push(`${relativeSource(file)}: ${match[0]}`);
            }
        }

        expect(violations).toEqual([]);
    });

    test('the worker passes mutation permission and trace context into the order seam', () => {
        const source = fs.readFileSync(workerPath, 'utf8');
        expect(source).toContain('mutationsAllowed: aiSettings.automation_mode === \'AI_ACTIVE\'');
        expect(source).toContain('conversationId,');
        expect(source).toContain('traceId: job.id || effExternalId || conversationId');
    });
});
