import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TodayResponse } from '@/api/mobile/schemas';
import type { ErrorKind } from '@/api/errors';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { formatBdCurrency } from '@/lib/currency';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

interface TodaySummaryProps {
  data: TodayResponse | undefined;
  isPending: boolean;
  isError: boolean;
  errorKind: ErrorKind | undefined;
  isOnline: boolean;
  onRetry: () => void;
}

/** The passive Today strip. A failed refresh keeps the last server snapshot visible and retryable. */
export function TodaySummary({ data, isPending, isError, errorKind, isOnline, onRetry }: TodaySummaryProps) {
  const { t } = useTranslation();

  if (!data && !isOnline) {
    return (
      <View style={styles.card} testID="today-summary-offline">
        <Text style={styles.errorText}>{t('mobile.home.offline.message')}</Text>
      </View>
    );
  }

  if (!data && isPending) {
    return (
      <View style={styles.card} testID="today-summary-loading">
        <ActivityIndicator color={brandColors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (!data && isError) {
    return (
      <View style={styles.card} testID="today-summary-error">
        <Text style={styles.errorText}>
          {t('mobile.home.today.unavailable')}
          {errorKind ? ` - ${t(apiErrorMessageKey(errorKind))}` : ''}
        </Text>
        <Pressable onPress={onRetry} accessibilityRole="button" testID="today-summary-retry">
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const expectedOrderValue = data.expected_order_value ?? data.revenue;
  const timezoneNote = data.timezone_note
    ? t('mobile.home.today.timezoneFallback', { timezone: data.timezone_used })
    : null;

  return (
    <View style={styles.card} testID="today-summary">
      <Text style={styles.title}>{t('mobile.home.today.title')}</Text>
      <View style={styles.row}>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {data.order_count}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.orders')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {formatBdCurrency(expectedOrderValue)}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.revenue')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {data.delivered_count}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.delivered')}
          </Text>
        </View>
      </View>
      {timezoneNote ? (
        <Text style={styles.timezoneNote} testID="today-timezone-note">
          {timezoneNote}
        </Text>
      ) : null}
      {isError ? (
        <View style={styles.staleNotice} testID="today-summary-stale">
          <Text style={styles.errorText}>
            {t('mobile.home.stale.message')}
            {errorKind ? ` - ${t(apiErrorMessageKey(errorKind))}` : ''}
          </Text>
          <Pressable onPress={onRetry} accessibilityRole="button" testID="today-summary-retry-stale">
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: neutral.surface,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
    padding: spacing.three,
    marginHorizontal: spacing.three,
    marginTop: spacing.three,
    gap: spacing.two,
  },
  title: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    color: brandColors.text,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.two,
    minWidth: 0,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: spacing.half,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: brandColors.primaryDark,
    flexShrink: 1,
    textAlign: 'center',
  },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    textAlign: 'center',
    flexShrink: 1,
  },
  timezoneNote: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
  },
  staleNotice: {
    borderTopWidth: 1,
    borderTopColor: neutral.border,
    paddingTop: spacing.two,
    gap: spacing.one,
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: brandColors.text,
    opacity: 0.8,
    flexShrink: 1,
  },
  retryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: brandColors.primaryDark,
  },
});
