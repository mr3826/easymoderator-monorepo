import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAttention } from '@/hooks/useAttention';
import { useToday } from '@/hooks/useToday';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useAuth } from '@/auth/AuthProvider';
import { openDeepLink } from '@/lib/deeplink';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import type { AttentionItem } from '@/api/mobile/schemas';
import { isNavigableEntity } from './attention-presentation';
import { TodaySummary } from './TodaySummary';
import { AttentionCard } from './AttentionCard';
import { brandColors, fontFamily, neutral, spacing } from '@/theme/tokens';

/**
 * The Home / "Needs Attention" screen (Phase 2, master brief) — the app's first real
 * merchant-value surface, and the first real consumer of `useAttention`/`useToday`
 * (`@/hooks`), which are themselves the first real `apiRequest` call sites in the app.
 *
 * All ranking/scoring is server-side (ADR M-008 §2.1) — this screen renders exactly what
 * `GET /api/mobile/attention` returns, in the order it returns it, and never re-sorts, re-slices,
 * or re-scores. State priority, most to least severe: no shop selected → offline with nothing
 * cached → initial loading → both queries failed with nothing cached → the ranked list (which
 * itself renders an idle/caught-up empty message, an inline per-query error, and an overflow
 * footer as needed).
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  const attentionQuery = useAttention();
  const todayQuery = useToday();

  const handleRefresh = useCallback(() => {
    void attentionQuery.refetch();
    void todayQuery.refetch();
  }, [attentionQuery, todayQuery]);

  const handleCardPress = useCallback((item: AttentionItem) => {
    // Defense in depth: `AttentionCard` already only wires `onPress` to a `Pressable` for a
    // navigable entity, but this is the one call site that actually reaches `openDeepLink`, so it
    // re-checks rather than trusting the caller. `id` always comes from the rendered item itself —
    // the authenticated, current-shop attention response — never from any other source.
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

  const isInitialLoading = (attentionQuery.isPending || todayQuery.isPending) && !hasAnyData;
  if (isInitialLoading) {
    return (
      <View style={styles.centerContainer} testID="home-loading">
        <ActivityIndicator size="large" color={brandColors.primary} />
      </View>
    );
  }

  // Both queries have settled by this point (neither is `isPending`) — if neither produced data,
  // both must have failed (a success always populates `data`, even with all-zero counts).
  if (!hasAnyData) {
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

  const items = attentionQuery.data?.items ?? [];
  const truncatedCount = attentionQuery.data?.truncated_count ?? 0;
  const isIdleShop =
    attentionQuery.isSuccess &&
    todayQuery.isSuccess &&
    items.length === 0 &&
    todayQuery.data.order_count === 0 &&
    todayQuery.data.delivered_count === 0;
  const isRefreshing = attentionQuery.isRefetching || todayQuery.isRefetching;

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
          <TodaySummary
            data={todayQuery.data}
            isPending={todayQuery.isPending}
            isError={todayQuery.isError}
            errorKind={todayQuery.error?.kind}
            onRetry={() => void todayQuery.refetch()}
          />
          <Text style={styles.sectionTitle}>{t('mobile.home.attention.title')}</Text>
          {attentionQuery.isError && !hasAttentionData ? (
            <View style={styles.inlineError} testID="attention-inline-error">
              <Text style={styles.stateMessage}>
                {t('mobile.home.attention.unavailable')}
                {attentionQuery.error ? ` — ${t(apiErrorMessageKey(attentionQuery.error.kind))}` : ''}
              </Text>
              <Pressable
                onPress={() => void attentionQuery.refetch()}
                accessibilityRole="button"
                testID="attention-retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        attentionQuery.isSuccess ? (
          <View style={styles.emptyContainer} testID="home-empty">
            <Text style={styles.stateTitle}>
              {isIdleShop ? t('mobile.home.empty.idle.title') : t('mobile.home.empty.caughtUp.title')}
            </Text>
            <Text style={styles.stateMessage}>
              {isIdleShop ? t('mobile.home.empty.idle.message') : t('mobile.home.empty.caughtUp.message')}
            </Text>
          </View>
        ) : null
      }
      ListFooterComponent={
        truncatedCount > 0 ? (
          <Text style={styles.overflowText} testID="attention-overflow">
            {t('mobile.home.attention.overflow', { count: truncatedCount })}
          </Text>
        ) : null
      }
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
  },
  stateMessage: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: brandColors.text,
    opacity: 0.8,
    textAlign: 'center',
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
  inlineError: {
    marginHorizontal: spacing.three,
    marginBottom: spacing.two,
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
  overflowText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    textAlign: 'center',
    marginTop: spacing.two,
  },
});
