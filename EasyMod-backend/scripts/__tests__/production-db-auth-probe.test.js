'use strict';

const { decodeRenderedEnvValue } = require('../production-db-auth-probe');

describe('production DB auth probe environment decoding', () => {
    test('decodes legacy JSON-quoted values without source-tree imports', () => {
        expect(decodeRenderedEnvValue(JSON.stringify('postgres://user:pass@db/easymod_prod')))
            .toBe('postgres://user:pass@db/easymod_prod');
    });

    test('preserves Docker-native values', () => {
        expect(decodeRenderedEnvValue('postgres://user:pass@db/easymod_prod'))
            .toBe('postgres://user:pass@db/easymod_prod');
    });

    test('preserves malformed quoted values so the probe fails closed', () => {
        const malformed = '"postgres://user:pass@db/easymod_prod';
        expect(decodeRenderedEnvValue(malformed)).toBe(malformed);
    });
});
