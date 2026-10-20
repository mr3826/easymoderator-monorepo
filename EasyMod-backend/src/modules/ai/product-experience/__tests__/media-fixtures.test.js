'use strict';

process.env.NODE_ENV = 'test';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageReferences } = require('../../../../../scripts/product-experience/replay');

const repoRoot = path.resolve(__dirname, '../../../../../../');
const manifestPath = path.join(repoRoot, 'docs/ai/product-experience-v1/media-fixtures/manifest.json');

describe('synthetic inbound media fixtures', () => {
    test('fixture checksums and metadata-only limitation are explicit', () => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        expect(manifest.sourceImagesProvided).toBe(false);
        expect(manifest.realVisionEvaluation).toBe('NOT_RUN');
        expect(manifest.fixtures).toHaveLength(4);
        expect(manifest.handling.customerImagesAreNotMerchantProductMedia).toBe(true);
        for (const fixture of manifest.fixtures) {
            const bytes = fs.readFileSync(path.join(repoRoot, fixture.path));
            expect(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase())
                .toBe(fixture.sha256);
            expect(fixture.modelInvoked).toBe(false);
        }
    });

    test('attachment labels resolve to fixture identities without treating labels as visual evidence', () => {
        expect(imageReferences('[Image 2: synthetic angle] [Image 4: printed instruction]', 'turn-1', 'IMAGE_IMAGE'))
            .toEqual(['image-2', 'image-4']);
        expect(imageReferences('', 'turn-2', 'IMAGE')).toEqual(['unresolved-turn-2']);
        expect(imageReferences('', 'turn-3', 'TEXT')).toEqual([]);
    });
});
