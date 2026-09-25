import path from 'node:path';
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import i18n from '@/i18n';
import { renderRouter, screen } from 'expo-router/testing-library';
import { AuthProvider } from '@/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';
import { __resetTokenStoreForTests } from '@/auth/token-store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  __resetTokenStoreForTests();
  queryClient.clear();
});

describe('tab shell', () => {
  it('renders all five tabs and defaults to the real Home screen', async () => {
    renderRouter(path.resolve(__dirname, '..'), { initialUrl: '/', wrapper: Wrapper });

    // No signed-in session is seeded here, so Home should show its no-shop state rather than
    // attempting the protected endpoint queries.
    expect(await screen.findByText(i18n.t('mobile.home.noShop.title'))).toBeTruthy();

    // All five tab bar labels are present in the tab bar itself, even though only the active
    // tab's screen body is mounted (MOBILE_ARCHITECTURE.md §3: Home · Inbox · + · Orders · More).
    expect(screen.getByText(i18n.t('mobile.tabs.home'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.inbox'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.quickAction'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.orders'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.tabs.more'))).toBeTruthy();
  });

  it('renders the Inbox placeholder after navigating to the Inbox tab', async () => {
    renderRouter(path.resolve(__dirname, '..'), { initialUrl: '/inbox', wrapper: Wrapper });

    expect(
      await screen.findByText(i18n.t('mobile.placeholder.phase2', { screen: i18n.t('mobile.tabs.inbox') })),
    ).toBeTruthy();
  });
});
