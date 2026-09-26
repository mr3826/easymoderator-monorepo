import type { ConfigContext } from 'expo/config';

import buildAppConfig from '../../app.config';

// The store identity of each build variant. A Play package name can never change once published,
// so the production identity is pinned here and a preview build must never share it.
const VARIANT_ENV = ['APP_VARIANT', 'EAS_BUILD_PROFILE', 'EXPO_PUBLIC_API_BASE_URL'] as const;
const saved = Object.fromEntries(VARIANT_ENV.map((name) => [name, process.env[name]]));

function resolve(variant: string) {
  process.env.APP_VARIANT = variant;
  delete process.env.EAS_BUILD_PROFILE;
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.easymod.tech';
  return buildAppConfig({ config: {} } as ConfigContext);
}

afterEach(() => {
  for (const name of VARIANT_ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('app.config.ts variant identity', () => {
  it('builds the Play identity for the production variant', () => {
    const config = resolve('production');
    expect(config.android?.package).toBe('tech.easymod.merchant');
    expect(config.scheme).toBe('easymodmerchant');
    expect(config.name).toBe('EasyMod');
    expect(config.extra?.appVariant).toBe('production');
  });

  it('keeps the preview variant on its own sideload identity', () => {
    const config = resolve('preview');
    expect(config.android?.package).toBe('tech.easymod.merchant.preview');
    expect(config.scheme).toBe('easymodmerchantpreview');
    expect(config.name).toBe('EasyMod (Preview)');
    expect(config.extra?.appVariant).toBe('preview');
  });

  it('refuses a production build with a plaintext API URL', () => {
    process.env.APP_VARIANT = 'production';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.easymod.tech';
    expect(() => buildAppConfig({ config: {} } as ConfigContext)).toThrow(/HTTPS/);
  });
});
