import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useOrder } from '@/hooks/useOrders';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

export function OrderDetailScreen({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useOrder(id ?? '');
  if (!id) return <OrderState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  if (query.isPending) return <View style={styles.center}><ActivityIndicator size="large" color={brandColors.primary} /></View>;
  if (query.error?.kind === 'notFound') return <OrderState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  if (query.isError) return <OrderState title={t('mobile.orders.detail.error.title')} message={t(apiErrorMessageKey(query.error.kind))} actionLabel={t('common.retry')} onAction={() => void query.refetch()} />;

  const order = query.data;
  const items = order.order_items ?? [];
  return (
    <SafeAreaView style={styles.container} testID="mobile-order-detail">
      <View style={styles.header}><Pressable onPress={() => router.back()} testID="mobile-order-back" accessibilityRole="button" style={styles.back}><Text style={styles.backText}>‹</Text></Pressable><View><Text style={styles.title}>{order.order_number || t('mobile.orders.unknownNumber')}</Text><Text style={styles.meta}>{order.order_status} · {order.payment_status}</Text></View></View>
      <FlatList
        data={items}
        keyExtractor={(item, index) => String(item.id ?? index)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.summary}>{order.customer_id ? <Pressable onPress={() => router.push({ pathname: '/customer-detail/[id]', params: { id: order.customer_id! } })} accessibilityRole="button"><Text style={styles.customer}>{order.customer_name || order.customer_phone || t('mobile.orders.unknownCustomer')}</Text></Pressable> : <Text style={styles.customer}>{order.customer_name || order.customer_phone || t('mobile.orders.unknownCustomer')}</Text>}<Text style={styles.amount}>{order.total ?? '--'} {order.currency || ''}</Text><Text style={styles.meta}>{order.fulfillment_status || t('mobile.orders.fulfillmentUnknown')}</Text><Text style={styles.sectionTitle}>{t('mobile.orders.detail.items')}</Text></View>}
        ListEmptyComponent={<Text style={styles.empty}>{t('mobile.orders.detail.noItems')}</Text>}
        renderItem={({ item }) => <View style={styles.item}><Text style={styles.itemName}>{String(item.name ?? item.product_name ?? t('mobile.orders.detail.unknownItem'))}</Text><Text style={styles.meta}>{String(item.quantity ?? 1)} × {String(item.total ?? item.price ?? '--')}</Text></View>}
      />
      <View style={styles.readOnly}><Text style={styles.readOnlyText}>{t('mobile.orders.detail.readOnly')}</Text></View>
    </SafeAreaView>
  );
}

function OrderState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) { return <View style={styles.center} testID="mobile-order-state"><Text style={styles.stateTitle}>{title}</Text><Text style={styles.meta}>{message}</Text>{actionLabel && onAction ? <Pressable onPress={onAction} style={styles.retry}><Text style={styles.retryText}>{actionLabel}</Text></Pressable> : null}</View>; }

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: brandColors.background }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.two, padding: spacing.two, borderBottomWidth: 1, borderBottomColor: neutral.border, backgroundColor: neutral.surface }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 36, color: brandColors.primaryDark }, title: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 17 }, meta: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textTransform: 'capitalize' }, content: { padding: spacing.three, paddingBottom: spacing.six }, summary: { gap: spacing.one, marginBottom: spacing.three }, customer: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18 }, amount: { color: brandColors.text, fontFamily: fontFamily.bold, fontSize: 22 }, sectionTitle: { marginTop: spacing.three, color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 16 }, item: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.two, paddingVertical: spacing.two, borderBottomWidth: 1, borderBottomColor: neutral.border }, itemName: { flex: 1, color: brandColors.text, fontFamily: fontFamily.regular, fontSize: 14 }, empty: { color: neutral.muted, fontFamily: fontFamily.regular }, readOnly: { borderTopWidth: 1, borderTopColor: neutral.border, padding: spacing.two, backgroundColor: neutral.surface }, readOnlyText: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textAlign: 'center' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four, gap: spacing.two, backgroundColor: brandColors.background }, stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' }, retry: { backgroundColor: brandColors.primary, borderRadius: radius.default, paddingHorizontal: spacing.four, paddingVertical: spacing.two }, retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
});
