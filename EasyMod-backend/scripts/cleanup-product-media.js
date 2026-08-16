#!/usr/bin/env node

'use strict';

const { cleanupProductMediaOrphans } = require('../src/modules/product/product-media.service');

cleanupProductMediaOrphans()
    .then((result) => {
        console.log(`Product media orphan sweep complete: ${result.removed} files, ${result.bytes} bytes removed.`);
    })
    .catch((error) => {
        console.error('Product media orphan sweep failed:', error.message);
        process.exitCode = 1;
    });
