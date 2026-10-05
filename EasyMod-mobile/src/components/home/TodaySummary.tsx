import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { TodayResponse } from '@/api/mobile/schemas';
import type { ErrorKind } from '@/api/errors';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { formatBdCurrency } from '@/lib/currency';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

export interface TodaySummaryProps {
  data: TodayResponse | undefined;
  isPending: boolean;
  isError: boolean;
  errorKind: ErrorKind | undefined;
  isOnline: boolean;
  onRetry: () => void;
  onFixProblems?: () => void;
}

/** The Daily Operational Summary card. A failed refresh keeps the last server snapshot visible and retryable. */
export function TodaySummary({
  data,
  isPending,
  isError,
  errorKind,
  isOnline,
  onRetry,
  onFixProblems,
}: TodaySummaryProps) {
  const { t } = useTranslation();
  let router: any = null;
  try {
    router = useRouter();
  } catch {
    router = null;
  }

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

  const courierProblems = data.pending_actions?.courier_problems ?? 0;
  const attentionNeeded =
    (data.pending_actions?.needs_reply ?? 0) +
    (data.pending_actions?.rto_verify ?? 0) +
    (data.pending_actions?.draft_orders ?? 0) +
    (data.pending_actions?.low_stock ?? 0) +
    courierProblems;

  const hasProblemsToFix = courierProblems > 0 || attentionNeeded > 0;

  return (
    <View style={styles.card} testID="today-summary">
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('mobile.home.today.title')}</Text>
        {courierProblems > 0 ? (
          <View style={styles.alertBadge} testID="today-courier-alert-badge">
            <Text style={styles.alertBadgeText}>
              {courierProblems} {t('mobile.home.today.courierProblems')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Primary KPI Row: Orders, Sales, Delivered */}
      <View style={styles.row}>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} testID="today-orders-count">
            {data.order_count}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.orders')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} testID="today-revenue-value">
            {formatBdCurrency(expectedOrderValue)}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.revenue')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} testID="today-delivered-count">
            {data.delivered_count}
          </Text>
          <Text style={styles.label} numberOfLines={2}>
            {t('mobile.home.today.delivered')}
          </Text>
        </View>
      </View>

      {/* Operational Status Row: Attention Needed & Courier Problems */}
      <View style={styles.secondaryRow}>
        <View style={styles.statusTile}>
          <Text style={styles.statusTileLabel}>{t('mobile.home.today.attentionNeeded')}</Text>
          <Text style={[styles.statusTileValue, attentionNeeded > 0 ? styles.attentionHighlight : null]} testID="today-attention-count">
            {attentionNeeded}
          </Text>
        </View>
        <View style={styles.statusTile}>
          <Text style={styles.statusTileLabel}>{t('mobile.home.today.courierProblems')}</Text>
          <Text style={[styles.statusTileValue, courierProblems > 0 ? styles.problemHighlight : null]} testID="today-problems-count">
            {courierProblems}
          </Text>
        </View>
      </View>

      {/* Primary CTA button: Fix Problems */}
      {hasProblemsToFix ? (
        <Pressable
          onPress={() => {
            if (onFixProblems) {
              onFixProblems();
            } else if (router?.push) {
              router.push('/courier-problems');
            }
          }}
          accessibilityRole="button"
          style={styles.fixProblemsBtn}
          testID="today-fix-problems-btn"
        >
          <Text style={styles.fixProblemsBtnText}>
            ⚠️ {t('mobile.home.today.fixProblems')}
          </Text>
        </Pressable>
      ) : null}

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

export const DailySummaryCard = TodaySummary;

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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    color: brandColors.text,
  },
  alertBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.half,
    borderRadius: radius.default,
  },
  alertBadgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    color: brandColors.destructive,
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
    paddingVertical: spacing.one,
    backgroundColor: brandColors.background,
    borderRadius: radius.default,
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
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.two,
    paddingTop: spacing.half,
  },
  statusTile: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.one,
    backgroundColor: neutral.surface,
    borderWidth: 1,
    borderColor: neutral.border,
    borderRadius: radius.default,
  },
  statusTileLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
  },
  statusTileValue: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: brandColors.text,
  },
  attentionHighlight: {
    color: '#D97706',
  },
  problemHighlight: {
    color: brandColors.destructive,
  },
  fixProblemsBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.default,
    paddingVertical: spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.half,
  },
  fixProblemsBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: brandColors.destructive,
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
