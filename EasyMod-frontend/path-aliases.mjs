/**
 * Import path configuration for easier imports
 * 
 * Usage:
 * import { useAuth } from '@features/auth';
 * import { httpClient } from '@shared/lib/http';
 * import { Button } from '@shared/ui';
 */

import { resolve } from 'path';

export default {
  alias: {
    '@': resolve(__dirname, './src'),
    '@shared': resolve(__dirname, './src/shared'),
    '@features': resolve(__dirname, './src/features'),
    '@shared/lib': resolve(__dirname, './src/shared/lib'),
    '@shared/ui': resolve(__dirname, './src/shared/ui'),
    '@shared/hooks': resolve(__dirname, './src/shared/hooks'),
    '@shared/types': resolve(__dirname, './src/shared/types'),
    '@test': resolve(__dirname, './src/test'),
  },
};
