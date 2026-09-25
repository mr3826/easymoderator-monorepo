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
  onRetry: () => void;
}

/**
 * The "Today" summary strip (master brief §4) — merchant-first counts, deliberately no
 * dashboard-style chart/graph: order count, revenue (via the shared BDT formatter), and delivered
 * count, in that order. Renders its own inline loading/error sub-state so a slow or failed
 * `/api/mobile/today` never blocks the (independently-fetched) attention list below it.
 */
export function TodaySummary({ data, isPending, isError, errorKind, onRetry }: TodaySummaryProps) {
  const { t } = useTranslation();

  if (!data && isPending) {
    return (
      <View style={styles.card} testID="today-summary-loading">
        <ActivityIndicator color={brandColors.primary} />
      </View>
    );
  }

  if (!data && isError) {
    return (
      <View style={styles.card} testID="today-summary-error">
        <Text style={styles.errorText}>
          {t('mobile.home.today.unavailable')}
          {errorKind ? ` — ${t(apiErrorMessageKey(errorKind))}` : ''}
        </Text>
        <Pressable onPress={onRetry} accessibilityRole="button" testID="today-summary-retry">
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  return (
    <View style={styles.card} testID="today-summary">
      <Text style={styles.title}>{t('mobile.home.today.title')}</Text>
      <View style={styles.row}>
        <View style={styles.tile}>
          <Text style={styles.value}>{data.order_count}</Text>
          <Text style={styles.label}>{t('mobile.home.today.orders')}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value}>{formatBdCurrency(data.revenue)}</Text>
          <Text style={styles.label}>{t('mobile.home.today.revenue')}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value}>{data.delivered_count}</Text>
          <Text style={styles.label}>{t('mobile.home.today.delivered')}</Text>
        </View>
      </View>
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
    justifyContent: 'space-between',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.half,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: brandColors.primaryDark,
  },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: brandColors.text,
    opacity: 0.8,
  },
  retryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: brandColors.primaryDark,
  },
});
