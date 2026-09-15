import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { AttentionItem } from '@/api/mobile/schemas';
import { entityPresentation, isNavigableEntity } from './attention-presentation';
import { brandColors, fontFamily, neutral, radius, spacing } from '@/theme/tokens';

interface AttentionCardProps {
  item: AttentionItem;
  onPress: (item: AttentionItem) => void;
}

/**
 * One "Needs Attention" list row (master brief §4). The icon/label come from `entity.type` only
 * (`attention-presentation.ts`); the tier badge is a plain "Priority N" pill — tier is a
 * cross-signal ranking position (ADR M-008 §2.1's table), not a value with its own human name, so
 * this never invents a per-tier adjective the backend didn't provide. The specific "why" is always
 * `item.reason`, verbatim from the server (already human-readable, e.g. "Draft order MA-3 (৳500)
 * has been awaiting confirmation for 10h") — this client never re-derives or re-scores it.
 *
 * A `product` card (no deep-link destination exists yet) renders identically except it is not
 * `Pressable` and carries no chevron — informational only, per the master brief.
 */
export function AttentionCard({ item, onPress }: AttentionCardProps) {
  const { t } = useTranslation();
  const { Icon, labelKey } = entityPresentation(item.entity.type);
  const navigable = isNavigableEntity(item.entity.type);
  const isUrgent = item.tier <= 2;

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconBadge, isUrgent && styles.iconBadgeUrgent]}>
        <Icon size={20} color={isUrgent ? brandColors.destructive : brandColors.primaryDark} />
      </View>
      <View style={styles.body}>
        <Text style={styles.reason} numberOfLines={3}>
          {item.reason}
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
    gap: spacing.half,
  },
  reason: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: brandColors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.one,
  },
  metaText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: neutral.muted,
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
