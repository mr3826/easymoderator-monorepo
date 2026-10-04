import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { apiErrorMessageKey } from '@/lib/api-error-i18n';
import { useCancelOrder, useConfirmOrder, useOrder, useOrderRisk } from '@/hooks/useOrders';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

export function OrderDetailScreen({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useOrder(id ?? '');
  const riskQuery = useOrderRisk(id ?? '');

  const confirmMutation = useConfirmOrder();
  const cancelMutation = useCancelOrder();

  if (!id) {
    return <OrderState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  }
  if (query.isPending) {
    return (
      <View style={styles.center} testID="mobile-order-loading">
        <ActivityIndicator size="large" color={brandColors.primary} />
      </View>
    );
  }
  if (query.error?.kind === 'notFound') {
    return <OrderState title={t('mobile.deeplink.unavailable.title')} message={t('mobile.deeplink.unavailable.message')} />;
  }
  if (query.isError) {
    return (
      <OrderState
        title={t('mobile.orders.detail.error.title')}
        message={t(apiErrorMessageKey(query.error.kind))}
        actionLabel={t('common.retry')}
        onAction={() => void query.refetch()}
      />
    );
  }

  const order = query.data;
  const items = order.order_items ?? [];
  const risk = riskQuery.data;

  const canConfirm = order.order_status === 'draft' || order.order_status === 'placed';
  const canCancel = order.order_status !== 'cancelled' && order.order_status !== 'returned';

  const handleCallCustomer = () => {
    if (order.customer_phone) {
      void Linking.openURL(`tel:${order.customer_phone}`);
    }
  };

  const handleOpenConversation = () => {
    router.push('/(tabs)/inbox');
  };

  const handleConfirmOrder = () => {
    setActionError(null);
    confirmMutation.mutate(
      { orderId: order.id },
      {
        onSuccess: () => {
          setConfirmModalVisible(false);
        },
        onError: (err) => {
          setConfirmModalVisible(false);
          setActionError(err.message || t('mobile.error.unknown'));
        },
      },
    );
  };

  const handleCancelOrder = () => {
    setActionError(null);
    cancelMutation.mutate(
      { orderId: order.id, reason: cancelReason },
      {
        onSuccess: () => {
          setCancelModalVisible(false);
          setCancelReason('');
        },
        onError: (err) => {
          setCancelModalVisible(false);
          setActionError(err.message || t('mobile.error.unknown'));
        },
      },
    );
  };

  const riskBadgeStyle = () => {
    if (risk?.risk_level === 'high') return styles.riskHighBadge;
    if (risk?.risk_level === 'medium') return styles.riskMediumBadge;
    return styles.riskLowBadge;
  };

  const riskBadgeText = () => {
    if (risk?.risk_level === 'high') return t('mobile.orders.detail.risk.riskHigh');
    if (risk?.risk_level === 'medium') return t('mobile.orders.detail.risk.riskMedium');
    return t('mobile.orders.detail.risk.riskLow');
  };

  return (
    <SafeAreaView style={styles.container} testID="mobile-order-detail">
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          testID="mobile-order-back"
          accessibilityRole="button"
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>{order.order_number || t('mobile.orders.unknownNumber')}</Text>
          <Text style={styles.meta}>{order.order_status} · {order.payment_status}</Text>
        </View>
      </View>

      {/* Action Error Banner */}
      {actionError ? (
        <View style={styles.errorBanner} testID="mobile-order-action-error">
          <Text style={styles.errorBannerText}>{actionError}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item, index) => String(item.id ?? index)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.summary}>
            {/* Customer Contact Card */}
            <View style={styles.customerCard}>
              <View style={styles.customerHeader}>
                <View>
                  <Text style={styles.customerName}>
                    {order.customer_name || order.customer_phone || t('mobile.orders.unknownCustomer')}
                  </Text>
                  {order.customer_phone ? (
                    <Text style={styles.customerPhone}>{order.customer_phone}</Text>
                  ) : null}
                </View>
                <View style={styles.contactActions}>
                  {order.customer_phone ? (
                    <Pressable
                      style={styles.contactButton}
                      onPress={handleCallCustomer}
                      testID="mobile-order-call-customer"
                      accessibilityRole="button"
                    >
                      <Text style={styles.contactButtonText}>{t('mobile.orders.detail.actions.callCustomer')}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.contactButtonSecondary}
                    onPress={handleOpenConversation}
                    testID="mobile-order-open-chat"
                    accessibilityRole="button"
                  >
                    <Text style={styles.contactButtonSecondaryText}>{t('mobile.orders.detail.actions.openConversation')}</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Verification & Risk Panel */}
            {risk ? (
              <View style={styles.riskCard} testID="mobile-order-risk-panel">
                <View style={styles.riskHeader}>
                  <Text style={styles.riskTitle}>{t('mobile.orders.detail.risk.title')}</Text>
                  <View style={[styles.riskBadge, riskBadgeStyle()]}>
                    <Text style={styles.riskBadgeText}>{riskBadgeText()}</Text>
                  </View>
                </View>

                {risk.has_duplicate_recent_order ? (
                  <View style={styles.duplicateWarning} testID="mobile-order-duplicate-warning">
                    <Text style={styles.duplicateWarningText}>
                      ⚠️ {t('mobile.orders.detail.risk.duplicateWarning')}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.riskStatsRow}>
                  <View style={styles.riskStat}>
                    <Text style={styles.riskStatValue}>{risk.delivered_count}</Text>
                    <Text style={styles.riskStatLabel}>{t('mobile.orders.detail.risk.delivered')}</Text>
                  </View>
                  <View style={styles.riskStatDivider} />
                  <View style={styles.riskStat}>
                    <Text style={[styles.riskStatValue, risk.rto_count > 0 ? styles.riskStatDestructive : null]}>
                      {risk.rto_count}
                    </Text>
                    <Text style={styles.riskStatLabel}>{t('mobile.orders.detail.risk.rto')}</Text>
                  </View>
                  <View style={styles.riskStatDivider} />
                  <View style={styles.riskStat}>
                    <Text style={styles.riskStatValue}>{risk.cancelled_count}</Text>
                    <Text style={styles.riskStatLabel}>{t('mobile.orders.detail.risk.cancelled')}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Total & Status */}
            <View style={styles.amountCard}>
              <Text style={styles.meta}>{t('mobile.orders.detail.items')}</Text>
              <Text style={styles.amount}>{order.total ?? '--'} {order.currency || 'BDT'}</Text>
              <Text style={styles.meta}>{order.fulfillment_status || t('mobile.orders.fulfillmentUnknown')}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('mobile.orders.detail.noItems')}</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.itemName}>
              {String(item.name ?? item.product_name ?? t('mobile.orders.detail.unknownItem'))}
            </Text>
            <Text style={styles.meta}>
              {String(item.quantity ?? 1)} × {String(item.total ?? item.price ?? '--')}
            </Text>
          </View>
        )}
      />

      {/* Sticky Bottom Actions Bar */}
      <View style={styles.actionBar}>
        {canConfirm ? (
          <Pressable
            style={[styles.confirmButton, confirmMutation.isPending ? styles.buttonDisabled : null]}
            onPress={() => setConfirmModalVisible(true)}
            disabled={confirmMutation.isPending}
            testID="mobile-order-confirm-btn"
            accessibilityRole="button"
          >
            {confirmMutation.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.confirmButtonText}>{t('mobile.orders.detail.actions.confirm')}</Text>
            )}
          </Pressable>
        ) : null}

        {canCancel ? (
          <Pressable
            style={[styles.cancelButton, cancelMutation.isPending ? styles.buttonDisabled : null]}
            onPress={() => setCancelModalVisible(true)}
            disabled={cancelMutation.isPending}
            testID="mobile-order-cancel-btn"
            accessibilityRole="button"
          >
            {cancelMutation.isPending ? (
              <ActivityIndicator color={brandColors.destructive} size="small" />
            ) : (
              <Text style={styles.cancelButtonText}>{t('mobile.orders.detail.actions.cancel')}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {/* Confirm Order Modal */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>{t('mobile.orders.detail.actions.confirmTitle')}</Text>
            <Text style={styles.modalMessage}>{t('mobile.orders.detail.actions.confirmPrompt')}</Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setConfirmModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel') || 'Cancel'}</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmBtn}
                onPress={handleConfirmOrder}
                testID="mobile-order-modal-confirm-submit"
              >
                <Text style={styles.modalConfirmText}>{t('mobile.orders.detail.actions.confirm')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cancel Order Modal */}
      <Modal
        visible={cancelModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>{t('mobile.orders.detail.actions.cancelTitle')}</Text>
            <Text style={styles.modalMessage}>{t('mobile.orders.detail.actions.cancelPrompt')}</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Reason for cancellation (optional)"
              placeholderTextColor={neutral.muted}
              value={cancelReason}
              onChangeText={setCancelReason}
              testID="mobile-order-cancel-reason-input"
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setCancelModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel') || 'Back'}</Text>
              </Pressable>
              <Pressable
                style={styles.modalDestructiveBtn}
                onPress={handleCancelOrder}
                testID="mobile-order-modal-cancel-submit"
              >
                <Text style={styles.modalDestructiveText}>{t('mobile.orders.detail.actions.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function OrderState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center} testID="mobile-order-state">
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.meta}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.retry}>
          <Text style={styles.retryText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brandColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    padding: spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: neutral.border,
    backgroundColor: neutral.surface,
  },
  headerInfo: { flex: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 36, color: brandColors.primaryDark },
  title: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 17 },
  meta: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12, textTransform: 'capitalize' },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#FCA5A5',
  },
  errorBannerText: {
    color: brandColors.destructive,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    textAlign: 'center',
  },
  content: { padding: spacing.three, paddingBottom: spacing.six },
  summary: { gap: spacing.two, marginBottom: spacing.three },
  customerCard: {
    backgroundColor: neutral.surface,
    padding: spacing.three,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
  },
  customerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.two,
  },
  customerName: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 17 },
  customerPhone: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14, marginTop: spacing.half },
  contactActions: { flexDirection: 'row', gap: spacing.one },
  contactButton: {
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.one,
  },
  contactButtonText: { color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 13 },
  contactButtonSecondary: {
    borderWidth: 1,
    borderColor: brandColors.primary,
    borderRadius: radius.default,
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.one,
  },
  contactButtonSecondaryText: { color: brandColors.primaryDark, fontFamily: fontFamily.medium, fontSize: 13 },
  riskCard: {
    backgroundColor: neutral.surface,
    padding: spacing.three,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
  },
  riskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.two,
  },
  riskTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 15 },
  riskBadge: {
    paddingHorizontal: spacing.two,
    paddingVertical: 2,
    borderRadius: 12,
  },
  riskLowBadge: { backgroundColor: '#D1FAE5' },
  riskMediumBadge: { backgroundColor: '#FEF3C7' },
  riskHighBadge: { backgroundColor: '#FEE2E2' },
  riskBadgeText: { fontFamily: fontFamily.medium, fontSize: 12, color: brandColors.text },
  duplicateWarning: {
    backgroundColor: '#FEF3C7',
    padding: spacing.two,
    borderRadius: 6,
    marginBottom: spacing.two,
  },
  duplicateWarningText: {
    color: '#92400E',
    fontFamily: fontFamily.medium,
    fontSize: 13,
  },
  riskStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: spacing.one,
  },
  riskStat: { alignItems: 'center' },
  riskStatValue: { color: brandColors.text, fontFamily: fontFamily.bold, fontSize: 18 },
  riskStatDestructive: { color: brandColors.destructive },
  riskStatLabel: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 12 },
  riskStatDivider: { width: 1, height: 24, backgroundColor: neutral.border },
  amountCard: {
    backgroundColor: neutral.surface,
    padding: spacing.three,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
  },
  amount: { color: brandColors.text, fontFamily: fontFamily.bold, fontSize: 24, marginVertical: spacing.half },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.two,
    paddingVertical: spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: neutral.border,
  },
  itemName: { flex: 1, color: brandColors.text, fontFamily: fontFamily.regular, fontSize: 14 },
  empty: { color: neutral.muted, fontFamily: fontFamily.regular, textAlign: 'center', padding: spacing.four },
  actionBar: {
    flexDirection: 'row',
    gap: spacing.two,
    padding: spacing.three,
    backgroundColor: neutral.surface,
    borderTopWidth: 1,
    borderTopColor: neutral.border,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingVertical: spacing.two + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold, fontSize: 16 },
  cancelButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: brandColors.destructive,
    borderRadius: radius.default,
    paddingVertical: spacing.two + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: { color: brandColors.destructive, fontFamily: fontFamily.semiBold, fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
    gap: spacing.two,
    backgroundColor: brandColors.background,
  },
  stateTitle: { color: brandColors.text, fontFamily: fontFamily.semiBold, fontSize: 18, textAlign: 'center' },
  retry: {
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
  },
  retryText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold },
  modalOverlay: {
    flex: 1,
    backgroundColor: neutral.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.four,
  },
  modalContainer: {
    backgroundColor: neutral.surface,
    borderRadius: radius.default,
    padding: spacing.four,
    width: '100%',
    maxWidth: 360,
    gap: spacing.two,
  },
  modalTitle: { color: brandColors.text, fontFamily: fontFamily.bold, fontSize: 18 },
  modalMessage: { color: neutral.muted, fontFamily: fontFamily.regular, fontSize: 14 },
  reasonInput: {
    borderWidth: 1,
    borderColor: neutral.border,
    borderRadius: radius.default,
    padding: spacing.two,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: brandColors.text,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.two, marginTop: spacing.two },
  modalCancelBtn: { paddingHorizontal: spacing.three, paddingVertical: spacing.two },
  modalCancelText: { color: neutral.muted, fontFamily: fontFamily.medium, fontSize: 15 },
  modalConfirmBtn: {
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
  },
  modalConfirmText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold, fontSize: 15 },
  modalDestructiveBtn: {
    backgroundColor: brandColors.destructive,
    borderRadius: radius.default,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
  },
  modalDestructiveText: { color: '#FFFFFF', fontFamily: fontFamily.semiBold, fontSize: 15 },
});
