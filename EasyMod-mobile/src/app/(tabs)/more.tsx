import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { env, getAppVersion } from '@/config/env';
import { brandColors, radius, spacing } from '@/theme/tokens';

/**
 * The "More" tab is a Phase 1 placeholder except for the logout action, which is real
 * infrastructure this phase must deliver (ADR M-004) rather than a feature screen.
 */
export default function MoreScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('mobile.placeholder.phase2', { screen: t('mobile.tabs.more') })}</Text>
      {user ? <Text style={styles.subtitle}>{t('mobile.more.loggedInAs', { email: user.email })}</Text> : null}
      <Text style={styles.buildInfo} testID="build-info">
        {t('mobile.more.buildInfo', {
          version: getAppVersion(),
          build: env.buildNumber,
          environment: env.appVariant,
          gitSha: env.gitSha,
        })}
      </Text>
      <Pressable
        style={styles.courierBtn}
        onPress={() => router.push('/courier-problems')}
        testID="more-courier-problems-button"
        accessibilityRole="button"
      >
        <Text style={styles.courierBtnText}>🚚 {t('mobile.courier.problemCenter.title', 'Courier Problem Center')}</Text>
      </Pressable>

      <Pressable
        style={[styles.button, loggingOut && styles.buttonDisabled]}
        onPress={handleLogout}
        disabled={loggingOut}
        accessibilityRole="button"
        testID="logout-button"
      >
        {loggingOut ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>{t('mobile.more.logout')}</Text>
        )}
      </Pressable>
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
    fontSize: 16,
    fontWeight: '600',
    color: brandColors.text,
  },
  subtitle: {
    fontSize: 13,
    color: brandColors.text,
    opacity: 0.7,
  },
  buildInfo: {
    maxWidth: 320,
    fontSize: 12,
    color: brandColors.text,
    opacity: 0.65,
    textAlign: 'center',
  },
  button: {
    backgroundColor: brandColors.destructive,
    borderRadius: radius.default,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
    minWidth: 140,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  courierBtn: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius.default,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
    minWidth: 200,
    alignItems: 'center',
    marginVertical: spacing.two,
  },
  courierBtnText: {
    color: '#1D4ED8',
    fontWeight: '600',
    fontSize: 14,
  },
});
