/**
 * Feature module template generator
 * Run: npx tsx scripts/generate-feature.ts <feature-name>
 */

import fs from 'fs';
import path from 'path';

const featureName = process.argv[2];

if (!featureName) {
  console.error('Usage: npx tsx scripts/generate-feature.ts <feature-name>');
  process.exit(1);
}

const featurePath = path.join(process.cwd(), 'src', 'features', featureName);
const dirs = [
  'components',
  'hooks',
  'api',
  'types',
  'utils',
  '__tests__',
];

// Create directories
dirs.forEach((dir) => {
  const dirPath = path.join(featurePath, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Create index.ts in each directory
const templates: Record<string, string> = {
  'types/index.ts': `/**
 * ${featureName} feature types
 */

export type Item = any; // TODO: Define your item type
`,
  'api/queries.ts': `/**
 * ${featureName} API queries (TanStack Query)
 * See: src/features/TEMPLATE-queries.ts for full template
 */

import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@shared/lib/http';

export const ${featureName}Queries = {
  all: () => ['${featureName}'] as const,
  lists: () => [...${featureName}Queries.all(), 'list'] as const,
  list: (filters?: any) => [...${featureName}Queries.lists(), { filters }] as const,
};

// TODO: Add useQuery hooks here
`,
  'api/mutations.ts': `/**
 * ${featureName} API mutations (TanStack Query)
 * See: src/features/TEMPLATE-mutations.ts for full template
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@shared/lib/http';

// TODO: Add useMutation hooks here
`,
  'api/types.ts': `/**
 * API schemas and types for ${featureName}
 */

import { z } from 'zod';

// TODO: Define Zod schemas for your API contracts
`,
  'api/index.ts': `/**
 * ${featureName} API layer exports
 */

export * from './queries';
export * from './mutations';
export * from './types';
`,
  'hooks/index.ts': `/**
 * ${featureName} custom hooks
 */

// TODO: Add feature-specific hooks here
`,
  'utils/index.ts': `/**
 * ${featureName} utility functions
 */

// TODO: Add feature-specific utilities here
`,
  'components/index.ts': `/**
 * ${featureName} components
 */

export { default as ${featureName}Page } from './${featureName}Page';
`,
  'components/Page.tsx': `/**
 * ${featureName} page component
 */

import { Suspense } from 'react';
import { Skeleton } from '@shared/ui/skeleton';
import { ErrorBoundary } from '@shared/ui/error-boundary';

export default function ${featureName}Page() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton className="w-full h-96" />}>
        <div className="p-6">
          <h1 className="text-3xl font-bold">${featureName}</h1>
          {/* TODO: Replace with actual feature content */}
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}
`,
  '__tests__/index.test.ts': `/**
 * ${featureName} feature tests
 */

describe('${featureName}', () => {
  it('todo', () => {
    expect(true).toBe(true);
  });
});
`,
  'index.ts': `/**
 * ${featureName} feature barrel export
 */

export * from './types';
export * from './api';
export * from './hooks';
// Note: Components are typically imported directly via path
`,
};

Object.entries(templates).forEach(([filePath, content]) => {
  const fullPath = path.join(featurePath, filePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, content.trim());
    console.log(`✓ Created ${filePath}`);
  }
});

console.log(`\n✓ Feature module "${featureName}" created`);
console.log(`\nNext steps:`);
console.log(`1. Update ${featurePath}/types/index.ts with your data types`);
console.log(`2. Add queries in ${featurePath}/api/queries.ts`);
console.log(`3. Add mutations in ${featurePath}/api/mutations.ts`);
console.log(`4. Create components in ${featurePath}/components/`);
console.log(`5. Add tests in ${featurePath}/__tests__/`);
