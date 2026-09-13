import path from 'node:path';

import i18n from '@/i18n';
import { renderRouter, screen } from 'expo-router/testing-library';

describe('tab shell', () => {
  it('renders all five tabs and defaults to the Home placeholder', async () => {
    renderRouter(path.resolve(__dirname, '..'), { initialUrl: '/' });

    // The Home screen's placeholder body renders immediately (it's the active tab).
    expect(await screen.findByText(i18n.t('mobile.placeholder.phase2', { screen: i18n.t('mobile.tabs.home') }))).toBeTruthy();

    // All five tab bar labels are present in the tab bar itself, even though only the active
    // tab's screen body is mounted (MOBILE_ARCHITECTURE.md §3: Home · Inbox · + · Orders · More).
    expect(screen.getByText(i18n.t('mobile.tabs.home'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.inbox'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.quickAction'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.orders'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.more'))).toBeTruthy();
  });

  it('renders the Inbox placeholder after navigating to the Inbox tab', async () => {
    renderRouter(path.resolve(__dirname, '..'), { initialUrl: '/inbox' });

    expect(
      await screen.findByText(i18n.t('mobile.placeholder.phase2', { screen: i18n.t('mobile.tabs.inbox') })),
    ).toBeTruthy();
  });
});
