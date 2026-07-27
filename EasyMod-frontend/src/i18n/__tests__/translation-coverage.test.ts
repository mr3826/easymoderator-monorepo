import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../locales/en.json';
import bn from '../locales/bn.json';

/**
 * i18next is configured without a missing-key handler, so an unknown key renders
 * as the literal key path. The Customers screen shipped 11 such keys and would
 * have shown merchants raw text like "customers.detail.phoneNumber" as a field
 * label. This test fails the build instead.
 */
const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.|__tests__/.test(full)) acc.push(full);
  }
  return acc;
}

const hasKey = (obj: unknown, key: string): boolean =>
  key.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj) !== undefined;

// Matches t('some.key') and t('some.key', 'Default text').
const T_CALL = /\bt\(\s*['"]([\w.]+)['"]/g;

const usedKeys = (() => {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = T_CALL.exec(src))) {
      if (!found.has(m[1])) found.set(m[1], path.relative(SRC, file).replace(/\\/g, '/'));
    }
  }
  return found;
})();

describe('translation coverage', () => {
  it('finds translation keys to check', () => {
    expect(usedKeys.size).toBeGreaterThan(100);
  });

  it('defines every t() key used in source in en.json', () => {
    const missing = [...usedKeys.entries()]
      .filter(([key]) => !hasKey(en, key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it('defines every t() key used in source in bn.json', () => {
    const missing = [...usedKeys.entries()]
      .filter(([key]) => !hasKey(bn, key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});
