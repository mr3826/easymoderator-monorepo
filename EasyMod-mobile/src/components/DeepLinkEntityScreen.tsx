import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useDeepLinkEntity } from '@/lib/deeplink-entity';
import type { DeepLinkEntityKind } from '@/lib/deeplink';
import { brandColors, radius, spacing } from '@/theme/tokens';

/**
 * Shared body for the two deep-link destination screens (`app/order/[id].tsx`,
 * `app/conversation/[id].tsx`) — Phase 2, Lane 4. Mirrors the placement precedent of
 * `PlaceholderScreen.tsx`: route files stay thin (read the param, pick a `kind`), the actual
 * state-machine rendering lives here once instead of twice.
 *
 * Renders one of four states, matching the master brief's required behaviors:
 * - loading: no flicker, no crash, while resolution is in flight.
 * - found: the normal case — an entity belonging to the signed-in user's current shop.
 * - unavailable: a wrong-shop id and a nonexistent/deleted id are refused identically — see
 *   `deeplink-entity.ts`'s `DeepLinkResolution` for why that collapse is deliberate.
 * - transientError: a real network/server hiccup — offers Retry, never claims the item is gone.
 */
export function DeepLinkEntityScreen({ kind, id }: { kind: DeepLinkEntityKind; id: string | undefined }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useDeepLinkEntity(kind, id ?? '');

  // A missing/malformed id (should already be caught by `+native-intent.ts` for the empty-string
  // case, but never trust a single layer) renders the same safe state as any other unresolvable
  // link — never a crash, never a blank screen.
  if (!id) {
    return <UnavailableBody t={t} />;
  }

  if (isPending) {
    return (
      <View style={styles.container} testID="deeplink-loading">
        <ActivityIndicator color={brandColors.primary} accessibilityLabel={t('mobile.deeplink.loading')} />
      </View>
    );
  }

  if (isError || data?.kind === 'transientError') {
    return (
      <View style={styles.container} testID="deeplink-error">
        <Text style={styles.title}>{t('mobile.deeplink.error.title')}</Text>
        <Text style={styles.body}>{t('mobile.deeplink.error.message')}</Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            void refetch();
          }}
          accessibilityRole="button"
          testID="deeplink-retry"
        >
          <Text style={styles.buttonText}>{t('mobile.deeplink.error.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (data?.kind === 'unavailable') {
    return <UnavailableBody t={t} />;
  }

  return (
    <View style={styles.container} testID="deeplink-found">
      <Text style={styles.title}>{t(`mobile.deeplink.${kind}.foundTitle`)}</Text>
      <Text style={styles.body}>{t(`mobile.deeplink.${kind}.foundBody`, { id: data?.id ?? id })}</Text>
    </View>
  );
}

function UnavailableBody({ t }: { t: TFunction }) {
  return (
    <View style={styles.container} testID="deeplink-unavailable">
      <Text style={styles.title}>{t('mobile.deeplink.unavailable.title')}</Text>
      <Text style={styles.body}>{t('mobile.deeplink.unavailable.message')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandColors.background,
    padding: spacing.four,
    gap: spacing.three,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: brandColors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: brandColors.text,
    opacity: 0.8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
    minWidth: 140,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
