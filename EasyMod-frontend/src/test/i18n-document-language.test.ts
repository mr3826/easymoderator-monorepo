import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';

describe('document language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('tracks the selected locale for assistive technology', async () => {
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');

    await i18n.changeLanguage('bn');
    expect(document.documentElement.lang).toBe('bn');
  });
});
