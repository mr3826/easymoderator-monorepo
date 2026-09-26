import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth/AuthProvider';
import type { AttentionItem } from '@/api/mobile/schemas';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useAttention } from '@/hooks/useAttention';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useToday } from '@/hooks/useToday';
import { openDeepLink } from '@/lib/deeplink';
import { brandColors, fontFamily, neutral, spacing } from '@/theme/tokens';
import { AttentionCard } from './AttentionCard';
import { isNavigableEntity } from './attention-presentation';
import { TodaySummary } from './TodaySummary';

/**
 * Merchant-first Home: the server owns attention ordering and scores; this screen only presents
 * the response and keeps the last good snapshot visible while a refresh fails.
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();
  const attentionQuery = useAttention();
  const todayQuery = useToday();
  const refetchAttention = attentionQuery.refetch;
  const refetchToday = todayQuery.refetch;
  const refreshInFlight = useRef<Promise<void> | null>(null);

  /** Coalesces pull-to-refresh events and never starts a request while offline. */
  const handleRefresh = useCallback((): Promise<void> => {
    if (!shopId || !isOnline) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;

    const nextRefresh = Promise.all([
      refetchAttention({ cancelRefetch: false }),
      refetchToday({ cancelRefetch: false }),
    ]).then(
      () => undefined,
      () => undefined,
    );
    refreshInFlight.current = nextRefresh;
    void nextRefresh.then(() => {
      if (refreshInFlight.current === nextRefresh) refreshInFlight.current = null;
    });
    return nextRefresh;
  }, [isOnline, refetchAttention, refetchToday, shopId]);

  const handleAttentionRetry = useCallback(() => {
    if (!isOnline) return;
    void refetchAttention({ cancelRefetch: false });
  }, [isOnline, refetchAttention]);

  const handleTodayRetry = useCallback(() => {
    if (!isOnline) return;
    void refetchToday({ cancelRefetch: false });
  }, [isOnline, refetchToday]);

  const handleCardPress = useCallback((item: AttentionItem) => {
    if (!isNavigableEntity(item.entity.type)) return;
    openDeepLink(item.entity.type, item.entity.id);
  }, []);

  if (!shopId) {
    return (
      <View style={styles.centerContainer} testID="home-no-shop">
        <Text style={styles.stateTitle}>{t('mobile.home.noShop.title')}</Text>
        <Text style={styles.stateMessage}>{t('mobile.home.noShop.message')}</Text>
      </View>
    );
  }

  const hasAttentionData = attentionQuery.data !== undefined;
  const hasTodayData = todayQuery.data !== undefined;
  const hasAnyData = hasAttentionData || hasTodayData;
  const hasErrorWithoutData =
    (!hasAttentionData && attentionQuery.isError) || (!hasTodayData && todayQuery.isError);
  const hasPendingWithoutData =
    (!hasAttentionData && attentionQuery.isPending) || (!hasTodayData && todayQuery.isPending);
  const hasPartialFailure = hasErrorWithoutData && hasPendingWithoutData;

  if (!isOnline && !hasAnyData) {
    return (
      <View style={styles.centerContainer} testID="home-offline">
        <Text style={styles.stateTitle}>{t('mobile.offline.bannerTitle')}</Text>
        <Text style={styles.stateMessage}>{t('mobile.home.offline.message')}</Text>
        <Pressable onPress={handleRefresh} accessibilityRole="button" style={styles.retryButton} testID="home-retry">
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasAnyData && hasErrorWithoutData && !hasPartialFailure) {
    const kind = attentionQuery.error?.kind ?? todayQuery.error?.kind;
    return (
      <View style={styles.centerContainer} testID="home-error">
        <Text style={styles.stateTitle}>{t('mobile.home.error.title')}</Text>
        <Text style={styles.stateMessage}>{kind ? t(apiErrorMessageKey(kind)) : ''}</Text>
        <Pressable onPress={handleRefresh} accessibilityRole="button" style={styles.retryButton} testID="home-retry">
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasAnyData && (attentionQuery.isPending || todayQuery.isPending) && !hasPartialFailure) {
    return (
      <View style={styles.centerContainer} testID="home-loading">
        <ActivityIndicator size="large" color={brandColors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (!hasAnyData && !hasPartialFailure) {
    return (
      <View style={styles.centerContainer} testID="home-error">
        <Text style={styles.stateTitle}>{t('mobile.home.error.title')}</Text>
        <Pressable onPress={handleRefresh} accessibilityRole="button" style={styles.retryButton} testID="home-retry">
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const items = attentionQuery.data?.items ?? [];
  const truncatedCount = attentionQuery.data?.truncated_count ?? 0;
  const conversationScanTruncated = Boolean(
    attentionQuery.data?.conversation_scan_truncated || todayQuery.data?.conversation_scan_truncated,
  );
  const isIdleShop =
    hasAttentionData &&
    hasTodayData &&
    items.length === 0 &&
    todayQuery.data.order_count === 0 &&
    todayQuery.data.delivered_count === 0;
  const isRefreshing = attentionQuery.isRefetching || todayQuery.isRefetching;
  const attentionStale = hasAttentionData && attentionQuery.isError;

  let emptyComponent: React.ReactElement | null = null;
  if (isOnline && hasAttentionData && !hasTodayData && todayQuery.isPending && items.length === 0) {
    emptyComponent = (
      <View style={styles.emptyContainer} testID="home-empty-waiting-for-today">
        <ActivityIndicator color={brandColors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  } else if (hasAttentionData && !hasTodayData && items.length === 0) {
    emptyComponent = (
      <View style={styles.emptyContainer} testID="home-empty-attention-only">
        <Text style={styles.stateTitle}>{t('mobile.home.empty.attentionOnly.title')}</Text>
        <Text style={styles.stateMessage}>{t('mobile.home.empty.attentionOnly.message')}</Text>
      </View>
    );
  } else if (hasAttentionData && items.length === 0 && hasTodayData) {
    emptyComponent = (
      <View style={styles.emptyContainer} testID="home-empty">
        <Text style={styles.stateTitle}>
          {isIdleShop ? t('mobile.home.empty.idle.title') : t('mobile.home.empty.caughtUp.title')}
        </Text>
        <Text style={styles.stateMessage}>
          {isIdleShop ? t('mobile.home.empty.idle.message') : t('mobile.home.empty.caughtUp.message')}
        </Text>
      </View>
    );
  }

  const footerComponent = truncatedCount > 0 || conversationScanTruncated ? (
    <View style={styles.footer}>
      {truncatedCount > 0 ? (
        <Text style={styles.overflowText} testID="attention-overflow">
          {t('mobile.home.attention.overflow', { count: truncatedCount })}
        </Text>
      ) : null}
      {conversationScanTruncated ? (
        <Text style={styles.overflowText} testID="attention-scan-truncated">
          {t('mobile.home.attention.scanTruncated')}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <FlatList
      testID="home-attention-list"
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <AttentionCard item={item} onPress={handleCardPress} />}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          colors={[brandColors.primary]}
          tintColor={brandColors.primary}
        />
      }
      ListHeaderComponent={
        <View>
          {!isOnline ? (
            <View style={styles.offlineNotice} testID="home-offline-cached" accessibilityRole="alert">
              <Text style={styles.offlineNoticeText}>{t('mobile.home.offline.cachedMessage')}</Text>
            </View>
          ) : null}
          <TodaySummary
            data={todayQuery.data}
            isPending={todayQuery.isPending}
            isError={todayQuery.isError}
            errorKind={todayQuery.error?.kind}
            isOnline={isOnline}
            onRetry={handleTodayRetry}
          />
          <Text style={styles.sectionTitle}>{t('mobile.home.attention.title')}</Text>
          {isOnline && attentionQuery.isPending && !hasAttentionData ? (
            <View style={styles.inlineLoading} testID="attention-loading">
              <ActivityIndicator color={brandColors.primary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : null}
          {!isOnline && !hasAttentionData ? (
            <View style={styles.inlineError} testID="attention-offline" accessibilityRole="alert">
              <Text style={styles.stateMessage}>{t('mobile.home.offline.message')}</Text>
            </View>
          ) : null}
          {attentionQuery.isError ? (
            <View
              style={styles.inlineError}
              testID={attentionStale ? 'attention-stale' : 'attention-inline-error'}
              accessibilityRole="alert"
            >
              <Text style={styles.stateMessage}>
                {attentionStale ? t('mobile.home.stale.message') : t('mobile.home.attention.unavailable')}
                {attentionQuery.error ? ` - ${t(apiErrorMessageKey(attentionQuery.error.kind))}` : ''}
              </Text>
              <Pressable onPress={handleAttentionRetry} accessibilityRole="button" testID="attention-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={emptyComponent}
      ListFooterComponent={footerComponent}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: brandColors.background,
  },
  listContent: {
    paddingVertical: spacing.three,
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandColors.background,
    padding: spacing.four,
    gap: spacing.two,
  },
  stateTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 17,
    color: brandColors.text,
    textAlign: 'center',
    flexShrink: 1,
  },
  stateMessage: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: brandColors.text,
    opacity: 0.8,
    textAlign: 'center',
    flexShrink: 1,
  },
  retryButton: {
    marginTop: spacing.two,
    backgroundColor: brandColors.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
  },
  retryButtonText: {
    fontFamily: fontFamily.semiBold,
    color: '#FFFFFF',
    fontSize: 14,
  },
  sectionTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    color: brandColors.text,
    marginHorizontal: spacing.three,
    marginTop: spacing.four,
    marginBottom: spacing.two,
  },
  offlineNotice: {
    marginHorizontal: spacing.three,
    padding: spacing.two,
    borderRadius: 8,
    backgroundColor: 'rgba(107, 114, 128, 0.12)',
  },
  offlineNoticeText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: neutral.muted,
    flexShrink: 1,
  },
  inlineLoading: {
    alignItems: 'center',
    paddingVertical: spacing.three,
  },
  inlineError: {
    marginHorizontal: spacing.three,
    marginBottom: spacing.two,
    padding: spacing.two,
    borderRadius: 8,
    backgroundColor: neutral.surface,
    borderWidth: 1,
    borderColor: neutral.border,
    gap: spacing.one,
  },
  retryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: brandColors.primaryDark,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.six,
    gap: spacing.two,
  },
  footer: {
    gap: spacing.one,
    marginTop: spacing.two,
  },
  overflowText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    textAlign: 'center',
    marginHorizontal: spacing.three,
  },
});
