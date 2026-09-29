import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useCustomerQuickView } from '@/hooks/useCustomer';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

export function CustomerQuickViewScreen({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useCustomerQuickView(id ?? '');
  if (!id) return <CustomerState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  if (query.isPending) return <View style={styles.center}><ActivityIndicator size="large" color={brandColors.primary} /></View>;
  if (query.error?.kind === 'notFound') return <CustomerState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  if (query.isError) return <CustomerState title={t('mobile.customers.error.title')} message={t(apiErrorMessageKey(query.error.kind))} actionLabel={t('common.retry')} onAction={() => void query.refetch()} />;

  const customer = query.data.customer;
  const orders = query.data.orders;
  const name = String(customer.name ?? customer.phone ?? t('mobile.customers.unknown'));
  return (
    <View style={styles.container} testID="mobile-customer-quick-view">
      <View style={styles.header}><Pressable onPress={() => router.back()} testID="mobile-customer-back" accessibilityRole="button" style={styles.back}><Text style={styles.backText}>‹</Text></Pressable><Text style={styles.title}>{t('mobile.customers.title')}</Text></View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.identity}><Text style={styles.name}>{name}</Text>{customer.phone ? <Text style={styles.meta}>{String(customer.phone)}</Text> : null}{customer.email ? <Text style={styles.meta}>{String(customer.email)}</Text> : null}<Text style={styles.section}>{t('mobile.customers.orders')}</Text></View>}
        ListEmptyComponent={<Text style={styles.meta}>{t('mobile.customers.noOrders')}</Text>}
        renderItem={({ item }) => <View style={styles.order}><Text style={styles.orderNumber}>{item.order_number || t('mobile.orders.unknownNumber')}</Text><Text style={styles.meta}>{item.order_status} · {item.total ?? '--'} {item.currency || ''}</Text></View>}
      />
      <View style={styles.readOnly}><Text style={styles.readOnlyText}>{t('mobile.customers.readOnly')}</Text></View>
    </View>
  );
}

function CustomerState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) { return <View style={styles.center} testID="mobile-customer-state"><Text style={styles.stateTitle}>{title}</Text><Text style={styles.meta}>{message}</Text>{actionLabel && onAction ? <Pressable onPress={onAction} style={styles.retry}><Text style={styles.retryText}>{actionLabel}</Text></Pressable> : null}</View>; }

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: brandColors.background }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.two, padding: spacing.two, borderBottomWidth: 1, borderBottomColor: neutral.border, backgroundColor: neutral.surface }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 36, color: brandColors.primaryDark }, title: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 17 }, content: { padding: spacing.three, paddingBottom: spacing.six }, identity: { gap: spacing.one, marginBottom: spacing.three }, name: { color: brandColors.text, fontFamily: fontFamily.bold, fontSize: 24 }, meta: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 13 }, section: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 16, marginTop: spacing.three }, order: { paddingVertical: spacing.two, borderBottomWidth: 1, borderBottomColor: neutral.border, gap: spacing.one }, orderNumber: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 15 }, readOnly: { borderTopWidth: 1, borderTopColor: neutral.border, padding: spacing.two, backgroundColor: neutral.surface }, readOnlyText: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textAlign: 'center' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.four, gap: spacing.two, backgroundColor: brandColors.background }, stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' }, retry: { backgroundColor: brandColors.primary, borderRadius: radius.default, paddingHorizontal: spacing.four, paddingVertical: spacing.two }, retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
});
