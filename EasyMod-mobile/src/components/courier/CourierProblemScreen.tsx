import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useBookCourier, useDeliveryTracking, useProblemParcels } from '@/hooks/useCourier';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import type { ProblemParcel } from '@/api/mobile/schemas';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

const COURIER_PROVIDERS = [
  { id: 'steadfast', label: 'Steadfast' },
  { id: 'pathao', label: 'Pathao' },
  { id: 'redx', label: 'RedX' },
];

export function CourierProblemScreen() {
  const { t } = useTranslation();
  const isOnline = useNetworkStatus();

  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [trackingModalOrderId, setTrackingModalOrderId] = useState<string | null>(null);
  const [bookingModalParcel, setBookingModalParcel] = useState<ProblemParcel | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('steadfast');
  const [bookingError, setBookingError] = useState<string | null>(null);

  const query = useProblemParcels({
    status: selectedStatus || undefined,
  });

  const bookMutation = useBookCourier();
  const trackingQuery = useDeliveryTracking(trackingModalOrderId ?? '');

  const parcels = query.data?.parcels ?? [];

  const handleCall = (phone: string | null | undefined) => {
    if (phone) {
      void Linking.openURL(`tel:${phone}`);
    }
  };

  const handleBookCourier = () => {
    if (!bookingModalParcel) return;
    setBookingError(null);

    bookMutation.mutate(
      {
        orderId: bookingModalParcel.order_id,
        provider: selectedProvider,
      },
      {
        onSuccess: () => {
          setBookingModalParcel(null);
          void query.refetch();
        },
        onError: (err) => {
          setBookingError(err.message || t('mobile.courier.problemCenter.bookError'));
        },
      },
    );
  };

  const statusBadgeStyle = (status: string | null | undefined) => {
    switch (status) {
      case 'returned':
      case 'failed_delivery':
      case 'failed':
      case 'damaged':
      case 'lost':
        return styles.badgeDestructive;
      case 'hold':
      case 'delayed':
      case 'courier_setup_required':
      case 'dispatch_indeterminate':
        return styles.badgeWarning;
      default:
        return styles.badgeNeutral;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('mobile.courier.problemCenter.title')}</Text>
        <Text style={styles.subtitle}>{t('mobile.courier.problemCenter.subtitle')}</Text>
      </View>

      {!isOnline ? (
        <View style={styles.offlineBanner} testID="mobile-courier-offline-banner">
          <Text style={styles.offlineBannerText}>
            ⚠️ {t('mobile.offline.banner', 'You are currently offline. Courier actions are disabled.')}
          </Text>
        </View>
      ) : null}

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <Pressable
          style={[styles.chip, !selectedStatus ? styles.chipActive : null]}
          onPress={() => setSelectedStatus('')}
          testID="mobile-courier-filter-all"
        >
          <Text style={[styles.chipText, !selectedStatus ? styles.chipTextActive : null]}>
            {t('mobile.courier.problemCenter.filterAll')}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.chip, selectedStatus === 'failed_delivery' ? styles.chipActive : null]}
          onPress={() => setSelectedStatus('failed_delivery')}
          testID="mobile-courier-filter-failed"
        >
          <Text style={[styles.chipText, selectedStatus === 'failed_delivery' ? styles.chipTextActive : null]}>
            {t('mobile.courier.problemCenter.filterFailed')}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.chip, selectedStatus === 'returned' ? styles.chipActive : null]}
          onPress={() => setSelectedStatus('returned')}
          testID="mobile-courier-filter-returned"
        >
          <Text style={[styles.chipText, selectedStatus === 'returned' ? styles.chipTextActive : null]}>
            {t('mobile.courier.problemCenter.filterReturned')}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.chip, selectedStatus === 'hold' ? styles.chipActive : null]}
          onPress={() => setSelectedStatus('hold')}
          testID="mobile-courier-filter-hold"
        >
          <Text style={[styles.chipText, selectedStatus === 'hold' ? styles.chipTextActive : null]}>
            {t('mobile.courier.problemCenter.filterHold')}
          </Text>
        </Pressable>
      </View>

      {query.isPending ? (
        <View style={styles.center} testID="mobile-courier-loading">
          <ActivityIndicator size="large" color={brandColors.primary} />
        </View>
      ) : (
        <FlatList
          data={parcels}
          keyExtractor={(item) => item.order_id}
          contentContainerStyle={styles.listContent}
          windowSize={5}
          maxToRenderPerBatch={5}
          removeClippedSubviews={true}
          initialNumToRender={8}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              colors={[brandColors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer} testID="mobile-courier-empty">
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={styles.emptyText}>{t('mobile.courier.problemCenter.empty')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card} testID={`mobile-courier-card-${item.order_id}`}>
              {/* Card Header */}
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.orderNumber}>
                    {item.order_number ? `#${item.order_number}` : 'Order'}
                  </Text>
                  <Text style={styles.providerBadge}>
                    {(item.delivery_provider || 'Courier').toUpperCase()}
                    {item.tracking_code ? ` • ${item.tracking_code}` : ''}
                  </Text>
                </View>

                <View style={[styles.badge, statusBadgeStyle(item.delivery_status)]}>
                  <Text style={styles.badgeText}>
                    {String(item.delivery_status || 'problem').replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>

              {/* Customer info */}
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{item.customer_name || 'Customer'}</Text>
                {item.customer_phone ? (
                  <Text style={styles.customerPhone}>{item.customer_phone}</Text>
                ) : null}
                {item.delivery_address ? (
                  <Text style={styles.customerAddress} numberOfLines={2}>
                    📍 {item.delivery_address}
                  </Text>
                ) : null}
              </View>

              {/* Reason / Notes */}
              {item.problem_reason ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText}>⚠️ {item.problem_reason}</Text>
                </View>
              ) : null}

              {/* Amount / COD notice */}
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>
                  {t('mobile.courier.tracking.codExpectation')}: ৳{item.total_amount}
                </Text>
                <Text style={styles.codNotice}>
                  ({t('mobile.orders.detail.courier.codDerivedNotice')})
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                {item.customer_phone ? (
                  <Pressable
                    style={styles.actionBtnCall}
                    onPress={() => handleCall(item.customer_phone)}
                    testID="mobile-courier-call-btn"
                    accessibilityRole="button"
                  >
                    <Text style={styles.actionBtnCallText}>
                      📞 {t('mobile.courier.problemCenter.callCustomer')}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={styles.actionBtnTrack}
                  onPress={() => setTrackingModalOrderId(item.order_id)}
                  testID="mobile-courier-track-btn"
                  accessibilityRole="button"
                >
                  <Text style={styles.actionBtnTrackText}>
                    🚚 {t('mobile.courier.problemCenter.viewTracking')}
                  </Text>
                </Pressable>

                {isOnline ? (
                  <Pressable
                    style={styles.actionBtnRetry}
                    onPress={() => setBookingModalParcel(item)}
                    testID="mobile-courier-retry-btn"
                    accessibilityRole="button"
                  >
                    <Text style={styles.actionBtnRetryText}>
                      🔄 {t('mobile.courier.problemCenter.retryBooking')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        />
      )}

      {/* Tracking Timeline Modal */}
      <Modal
        visible={Boolean(trackingModalOrderId)}
        transparent
        animationType="slide"
        onRequestClose={() => setTrackingModalOrderId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox} testID="mobile-courier-tracking-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('mobile.courier.tracking.title')}</Text>
              <Pressable
                onPress={() => setTrackingModalOrderId(null)}
                style={styles.modalCloseBtn}
                testID="mobile-courier-modal-close"
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            {trackingQuery.isPending ? (
              <ActivityIndicator size="small" color={brandColors.primary} style={{ marginVertical: spacing.four }} />
            ) : trackingQuery.data ? (
              <View style={styles.timelineContent}>
                <View style={styles.trackingOverview}>
                  <Text style={styles.overviewText}>
                    {t('mobile.courier.tracking.provider')}: {trackingQuery.data.provider?.toUpperCase()}
                  </Text>
                  <Text style={styles.overviewText}>
                    {t('mobile.courier.tracking.trackingNumber')}: {trackingQuery.data.tracking_number || '--'}
                  </Text>
                  <Text style={styles.overviewStatus}>
                    {t('mobile.courier.tracking.status')}: {trackingQuery.data.current_status}
                  </Text>
                  <Text style={styles.timelineNotice}>
                    ℹ️ {trackingQuery.data.cod_derived_note || t('mobile.courier.tracking.codNotice')}
                  </Text>
                </View>

                <Text style={styles.timelineHeading}>{t('mobile.courier.tracking.history')}</Text>

                {trackingQuery.data.status_history && trackingQuery.data.status_history.length > 0 ? (
                  trackingQuery.data.status_history.map((step, idx) => (
                    <View key={idx} style={styles.timelineStep}>
                      <View style={styles.timelineDot} />
                      <View style={styles.timelineStepContent}>
                        <Text style={styles.timelineStepStatus}>{step.status}</Text>
                        {step.location ? (
                          <Text style={styles.timelineStepLocation}>{step.location}</Text>
                        ) : null}
                        {step.timestamp ? (
                          <Text style={styles.timelineStepTime}>
                            {new Date(step.timestamp).toLocaleString()}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noHistoryText}>{t('mobile.courier.tracking.noHistory')}</Text>
                )}
              </View>
            ) : (
              <Text style={styles.noHistoryText}>{t('mobile.courier.tracking.noHistory')}</Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Re-book / Courier Booking Modal */}
      <Modal
        visible={Boolean(bookingModalParcel)}
        transparent
        animationType="fade"
        onRequestClose={() => setBookingModalParcel(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox} testID="mobile-courier-booking-modal">
            <Text style={styles.modalTitle}>{t('mobile.courier.problemCenter.confirmRetry')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('mobile.courier.problemCenter.retryPrompt')}
            </Text>

            {bookingError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{bookingError}</Text>
              </View>
            ) : null}

            <Text style={styles.providerSelectHeading}>
              {t('mobile.courier.problemCenter.selectProvider')}
            </Text>
            <View style={styles.providerRow}>
              {COURIER_PROVIDERS.map((provider) => (
                <Pressable
                  key={provider.id}
                  style={[
                    styles.providerOption,
                    selectedProvider === provider.id ? styles.providerOptionSelected : null,
                  ]}
                  onPress={() => setSelectedProvider(provider.id)}
                  testID={`mobile-courier-provider-${provider.id}`}
                >
                  <Text
                    style={[
                      styles.providerOptionText,
                      selectedProvider === provider.id ? styles.providerOptionTextSelected : null,
                    ]}
                  >
                    {provider.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalActionRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => {
                  setBookingModalParcel(null);
                  setBookingError(null);
                }}
                disabled={bookMutation.isPending}
              >
                <Text style={styles.modalCancelBtnText}>{t('common.cancel', 'Cancel')}</Text>
              </Pressable>

              <Pressable
                style={styles.modalSubmitBtn}
                onPress={handleBookCourier}
                disabled={bookMutation.isPending}
                testID="mobile-courier-confirm-book-btn"
              >
                {bookMutation.isPending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>
                    {t('mobile.courier.problemCenter.confirmRetry')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: brandColors.background,
  },
  header: {
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    color: brandColors.text,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: neutral.muted,
    marginTop: spacing.half,
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
    marginHorizontal: spacing.three,
    borderRadius: radius.default,
    marginBottom: spacing.two,
  },
  offlineBannerText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: '#92400E',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.three,
    paddingBottom: spacing.two,
    gap: spacing.two,
  },
  chip: {
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.one,
    borderRadius: 16,
    backgroundColor: '#E5E7EB',
  },
  chipActive: {
    backgroundColor: brandColors.primary,
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: neutral.muted,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontFamily: fontFamily.semiBold,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.three,
    paddingBottom: spacing.five,
    gap: spacing.three,
  },
  emptyContainer: {
    paddingVertical: spacing.six,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.two,
  },
  emptyText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: neutral.muted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: neutral.surface,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
    padding: spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.two,
  },
  orderNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    color: brandColors.text,
  },
  providerBadge: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: neutral.muted,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: spacing.two,
    paddingVertical: spacing.half,
    borderRadius: radius.default,
  },
  badgeDestructive: {
    backgroundColor: '#FEE2E2',
  },
  badgeWarning: {
    backgroundColor: '#FEF3C7',
  },
  badgeNeutral: {
    backgroundColor: '#F3F4F6',
  },
  badgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    color: brandColors.text,
    textTransform: 'uppercase',
  },
  customerInfo: {
    marginVertical: spacing.one,
  },
  customerName: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: brandColors.text,
  },
  customerPhone: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: neutral.muted,
    marginTop: 2,
  },
  customerAddress: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    marginTop: 2,
  },
  reasonBox: {
    backgroundColor: '#FFFBEB',
    padding: spacing.two,
    borderRadius: radius.default,
    marginVertical: spacing.two,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  reasonText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: '#B45309',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.one,
    marginTop: spacing.one,
    marginBottom: spacing.two,
  },
  amountLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: brandColors.text,
  },
  codNotice: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: neutral.muted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.two,
    marginTop: spacing.two,
    paddingTop: spacing.two,
    borderTopWidth: 1,
    borderTopColor: neutral.border,
  },
  actionBtnCall: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnCallText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    color: '#1D4ED8',
  },
  actionBtnTrack: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnTrackText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    color: brandColors.text,
  },
  actionBtnRetry: {
    flex: 1,
    backgroundColor: brandColors.primary,
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnRetryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: neutral.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.three,
  },
  modalBox: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: neutral.surface,
    borderRadius: radius.default,
    padding: spacing.four,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.three,
  },
  modalTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: brandColors.text,
  },
  modalSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: neutral.muted,
    marginBottom: spacing.three,
  },
  modalCloseBtn: {
    padding: spacing.one,
  },
  modalCloseBtnText: {
    fontSize: 18,
    color: neutral.muted,
  },
  timelineContent: {
    marginTop: spacing.two,
  },
  trackingOverview: {
    backgroundColor: '#F9FAFB',
    padding: spacing.two,
    borderRadius: radius.default,
    marginBottom: spacing.three,
  },
  overviewText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: brandColors.text,
    marginBottom: 2,
  },
  overviewStatus: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: brandColors.primary,
    marginTop: spacing.one,
  },
  timelineNotice: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: neutral.muted,
    marginTop: spacing.one,
  },
  timelineHeading: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: brandColors.text,
    marginBottom: spacing.two,
  },
  timelineStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.three,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: brandColors.primary,
    marginTop: 5,
    marginRight: spacing.two,
  },
  timelineStepContent: {
    flex: 1,
  },
  timelineStepStatus: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: brandColors.text,
  },
  timelineStepLocation: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
  },
  timelineStepTime: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: neutral.muted,
  },
  noHistoryText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: neutral.muted,
    textAlign: 'center',
    marginVertical: spacing.three,
  },
  providerSelectHeading: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: brandColors.text,
    marginBottom: spacing.two,
  },
  providerRow: {
    flexDirection: 'row',
    gap: spacing.two,
    marginBottom: spacing.four,
  },
  providerOption: {
    flex: 1,
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
    alignItems: 'center',
  },
  providerOptionSelected: {
    borderColor: brandColors.primary,
    backgroundColor: '#E8F5E9',
  },
  providerOptionText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: brandColors.text,
  },
  providerOptionTextSelected: {
    fontFamily: fontFamily.bold,
    color: brandColors.primary,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: spacing.two,
    borderRadius: radius.default,
    marginBottom: spacing.three,
  },
  errorBannerText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: brandColors.destructive,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: spacing.two,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    borderWidth: 1,
    borderColor: neutral.border,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    color: neutral.muted,
  },
  modalSubmitBtn: {
    flex: 1,
    backgroundColor: brandColors.primary,
    paddingVertical: spacing.two,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
