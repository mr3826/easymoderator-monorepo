import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { AttentionItem } from '@/api/mobile/schemas';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';
import { entityPresentation, isNavigableEntity } from './attention-presentation';

const REASON_KEYS: Record<string, string> = {
  COURIER_DISPATCH_FAILED: 'mobile.home.reasons.COURIER_DISPATCH_FAILED',
  COURIER_DISPATCH_INDETERMINATE: 'mobile.home.reasons.COURIER_DISPATCH_INDETERMINATE',
  COURIER_SETUP_REQUIRED: 'mobile.home.reasons.COURIER_SETUP_REQUIRED',
  PROVIDER_SEND_FAILED: 'mobile.home.reasons.PROVIDER_SEND_FAILED',
  AI_FAILED: 'mobile.home.reasons.AI_FAILED',
  DRAFT_REVIEW_REQUIRED: 'mobile.home.reasons.DRAFT_REVIEW_REQUIRED',
  HITL_REQUIRED: 'mobile.home.reasons.HITL_REQUIRED',
  CUSTOMER_UNANSWERED: 'mobile.home.reasons.CUSTOMER_UNANSWERED',
  DRAFT_ORDER_AWAITING_CONFIRMATION: 'mobile.home.reasons.DRAFT_ORDER_AWAITING_CONFIRMATION',
  RTO_VERIFICATION_REQUIRED: 'mobile.home.reasons.RTO_VERIFICATION_REQUIRED',
  LOW_STOCK: 'mobile.home.reasons.LOW_STOCK',
};

const SIGNAL_REASON_KEYS: Record<AttentionItem['signal_type'], string> = {
  COURIER_FAILED: REASON_KEYS.COURIER_DISPATCH_FAILED,
  COURIER_INDETERMINATE: REASON_KEYS.COURIER_DISPATCH_INDETERMINATE,
  COURIER_SETUP_REQUIRED: REASON_KEYS.COURIER_SETUP_REQUIRED,
  INBOX_NEEDS_REPLY: REASON_KEYS.CUSTOMER_UNANSWERED,
  DRAFT_ORDER: REASON_KEYS.DRAFT_ORDER_AWAITING_CONFIRMATION,
  RTO_VERIFY: REASON_KEYS.RTO_VERIFICATION_REQUIRED,
  LOW_STOCK: REASON_KEYS.LOW_STOCK,
};

interface AttentionCardProps {
  item: AttentionItem;
  onPress: (item: AttentionItem) => void;
}

/** Renders one server-ranked attention item without client-side scoring or reordering. */
export function AttentionCard({ item, onPress }: AttentionCardProps) {
  const { t, i18n } = useTranslation();
  const { Icon, labelKey } = entityPresentation(item.entity.type);
  const navigable = isNavigableEntity(item.entity.type);
  const isUrgent = item.tier <= 2;
  const reasonKey = item.reason_code ? REASON_KEYS[item.reason_code] : undefined;
  const reason = i18n.language.startsWith('bn')
    ? t(reasonKey ?? SIGNAL_REASON_KEYS[item.signal_type])
    : item.reason;

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconBadge, isUrgent && styles.iconBadgeUrgent]}>
        <Icon size={20} color={isUrgent ? brandColors.destructive : brandColors.primaryDark} />
      </View>
      <View style={styles.body}>
        <Text style={styles.reason} numberOfLines={3}>
          {reason}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{t(labelKey)}</Text>
          <Text style={styles.metaDot}>{'·'}</Text>
          <Text style={[styles.metaText, isUrgent && styles.metaTextUrgent]}>
            {t('mobile.home.attention.priority', { tier: item.tier })}
          </Text>
        </View>
      </View>
      {navigable ? <Text style={styles.chevron}>{'›'}</Text> : null}
    </View>
  );

  if (!navigable) {
    return (
      <View style={styles.card} testID={`attention-card-${item.id}`} accessibilityRole="text">
        {content}
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      testID={`attention-card-${item.id}`}
    >
      {content}
    </Pressable>
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
    marginBottom: spacing.two,
  },
  cardPressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    minWidth: 0,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 166, 81, 0.12)',
  },
  iconBadgeUrgent: {
    backgroundColor: 'rgba(212, 24, 61, 0.12)',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.half,
  },
  reason: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: brandColors.text,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    minWidth: 0,
    gap: spacing.one,
  },
  metaText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
    flexShrink: 1,
  },
  metaTextUrgent: {
    color: brandColors.destructive,
    fontFamily: fontFamily.semiBold,
  },
  metaDot: {
    color: neutral.muted,
    fontSize: 12,
  },
  chevron: {
    fontSize: 22,
    color: neutral.muted,
    paddingLeft: spacing.one,
  },
});
