import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { OrderSummary } from '@/api/mobile/schemas';
import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOrders } from '@/hooks/useOrders';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

type OrderFilter = 'all' | 'draft' | 'confirmed' | 'finalized' | 'cancelled';

export function OrdersScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const isOnline = useNetworkStatus();
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  const query = useOrders(filter === 'all' ? undefined : filter);
  const orders = useMemo(() => query.data?.pages.flatMap((page) => page.orders) ?? [], [query.data?.pages]);
  const term = search.trim().toLocaleLowerCase();
  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (!term) return true;
    return [order.order_number, order.customer_name, order.customer_phone]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(term));
  }), [orders, term]);

  if (!user?.shopId) return <OrderState title={t('mobile.home.noShop.title')} message={t('mobile.home.noShop.message')} />;
  if (!isOnline && orders.length === 0) return <OrderState title={t('mobile.orders.offline.title')} message={t('mobile.orders.offline.message')} />;
  if (query.isPending && orders.length === 0) return <OrderLoading />;
  if (query.isError && orders.length === 0) {
    return <OrderState title={t('mobile.orders.error.title')} message={t(apiErrorMessageKey(query.error.kind))} actionLabel={t('common.retry')} onAction={() => void query.refetch()} />;
  }

  return (
    <FlatList
      testID="mobile-orders-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={visibleOrders}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} colors={[brandColors.primary]} />}
      ListHeaderComponent={(
        <View>
          <Text style={styles.title}>{t('mobile.orders.title')}</Text>
          <TextInput testID="mobile-orders-search" value={search} onChangeText={setSearch} placeholder={t('mobile.orders.searchPlaceholder')} placeholderTextColor={neutral.muted} accessibilityLabel={t('mobile.orders.searchPlaceholder')} style={styles.search} autoCapitalize="none" />
          <View style={styles.filters} accessibilityRole="tablist">
            {(['all', 'draft', 'confirmed', 'finalized', 'cancelled'] as const).map((option) => (
              <Pressable key={option} testID={`mobile-orders-filter-${option}`} accessibilityRole="tab" accessibilityState={{ selected: filter === option }} onPress={() => setFilter(option)} style={[styles.filter, filter === option && styles.filterActive]}>
                <Text style={[styles.filterText, filter === option && styles.filterTextActive]}>{t(`mobile.orders.filters.${option}`)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      ListEmptyComponent={<OrderState title={t('mobile.orders.empty.title')} message={search ? t('mobile.orders.empty.searchMessage') : t('mobile.orders.empty.message')} />}
      renderItem={({ item }) => <OrderRow order={item} onPress={() => router.push({ pathname: '/order-detail/[id]', params: { id: item.id } })} />}
      onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={brandColors.primary} /> : null}
    />
  );
}

function OrderRow({ order, onPress }: { order: OrderSummary; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable testID={`mobile-order-${order.id}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowHeader}>
        <Text style={styles.orderNumber}>{order.order_number || t('mobile.orders.unknownNumber')}</Text>
        <Text style={styles.status}>{order.order_status || t('mobile.orders.unknownStatus')}</Text>
      </View>
      <Text style={styles.customer} numberOfLines={1}>{order.customer_name || order.customer_phone || t('mobile.orders.unknownCustomer')}</Text>
      <View style={styles.rowFooter}>
        <Text style={styles.amount}>{order.total ?? '--'} {order.currency || ''}</Text>
        <Text style={styles.payment}>{order.payment_status || t('mobile.orders.paymentUnknown')}</Text>
      </View>
    </Pressable>
  );
}

function OrderLoading() { return <View style={styles.center} testID="mobile-orders-loading"><ActivityIndicator size="large" color={brandColors.primary} /></View>; }

function OrderState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.center} testID="mobile-orders-state"><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateMessage}>{message}</Text>{actionLabel && onAction ? <Pressable onPress={onAction} style={styles.retry}><Text style={styles.retryText}>{actionLabel}</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: brandColors.background }, content: { padding: spacing.three, paddingBottom: spacing.six, flexGrow: 1 },
  title: { fontFamily: fontFamily.bold, fontSize: 24, color: brandColors.text, marginBottom: spacing.two }, search: { borderWidth: 1, borderColor: neutral.border, borderRadius: radius.default, backgroundColor: neutral.surface, color: brandColors.text, fontFamily: fontFamily.regular, fontSize: 15, paddingHorizontal: spacing.three, paddingVertical: spacing.two },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.one, marginVertical: spacing.three }, filter: { borderRadius: radius.default, borderWidth: 1, borderColor: neutral.border, paddingHorizontal: spacing.two, paddingVertical: spacing.one }, filterActive: { backgroundColor: brandColors.primary, borderColor: brandColors.primary }, filterText: { color: neutral.muted, fontFamily: fontFamily.medium, fontSize: 12 }, filterTextActive: { color: '#FFFFFF' },
  row: { backgroundColor: neutral.surface, borderRadius: radius.default, padding: spacing.three, marginBottom: spacing.two, borderWidth: 1, borderColor: neutral.border, gap: spacing.one }, rowPressed: { opacity: 0.75 }, rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.two }, orderNumber: { flex: 1, color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 16 }, status: { color: brandColors.primaryDark, fontFamily: fontFamily.medium, fontSize: 12, textTransform: 'capitalize' }, customer: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14 }, rowFooter: { flexDirection: 'row', justifyContent: 'space-between' }, amount: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 14 }, payment: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textTransform: 'capitalize' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four, gap: spacing.two, backgroundColor: brandColors.background }, stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' }, stateMessage: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14, textAlign: 'center' }, retry: { backgroundColor: brandColors.primary, borderRadius: radius.default, paddingHorizontal: spacing.four, paddingVertical: spacing.two }, retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
});
