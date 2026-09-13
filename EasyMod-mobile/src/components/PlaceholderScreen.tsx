import { StyleSheet, Text, View } from 'react-native';

import { brandColors, spacing } from '@/theme/tokens';

/**
 * Phase 1 is the shell, auth, and infrastructure — not the feature screens (those are Phase 2+,
 * see `MOBILE_ARCHITECTURE.md`). Every tab renders one of these until its real screen is built.
 */
export function PlaceholderScreen({ label }: { label: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
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
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: brandColors.text,
    textAlign: 'center',
  },
});
