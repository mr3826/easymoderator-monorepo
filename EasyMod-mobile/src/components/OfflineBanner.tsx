import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { neutral, spacing } from '@/theme/tokens';

/** Persistent offline banner (ADR M-011) — no mutation queue, so this is purely informational. */
export function OfflineBanner() {
  const isOnline = useNetworkStatus();
  const { t } = useTranslation();

  if (isOnline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.title}>{t('mobile.offline.bannerTitle')}</Text>
      <Text style={styles.message}>{t('mobile.offline.mutationsDisabled')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: neutral.muted,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
    gap: spacing.half,
  },
  title: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 12,
  },
});
