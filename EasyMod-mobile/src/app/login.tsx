import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { brandColors, radius, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setFormError(null);

    if (!email.trim()) {
      setFormError(t('auth.signin.errors.emailRequired'));
      return;
    }
    if (!password) {
      setFormError(t('auth.signin.errors.passwordRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(email.trim(), password);
      if (!result.ok) {
        setFormError(result.message ?? t('auth.signin.errors.invalidCredentials'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.heading}>{t('auth.signin.welcomeBack')}</Text>
        <Text style={styles.subheading}>{t('auth.signin.loginPrompt')}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.signin.emailLabel')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.signin.emailPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!submitting}
            testID="login-email-input"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.signin.passwordLabel')}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.signin.passwordPlaceholder')}
            secureTextEntry
            editable={!submitting}
            testID="login-password-input"
          />
        </View>

        {formError ? (
          <Text style={styles.errorText} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityRole="button"
          testID="login-submit"
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>{t('auth.signin.signInButton')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: brandColors.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.four,
    gap: spacing.two,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: brandColors.text,
  },
  subheading: {
    fontSize: 14,
    color: brandColors.text,
    opacity: 0.7,
    marginBottom: spacing.three,
  },
  field: {
    gap: spacing.half,
    marginBottom: spacing.two,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: brandColors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: radius.default,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
    fontSize: 15,
    color: brandColors.text,
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    color: brandColors.destructive,
    fontSize: 13,
  },
  button: {
    marginTop: spacing.three,
    backgroundColor: brandColors.primary,
    borderRadius: radius.default,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
