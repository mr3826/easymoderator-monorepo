import { useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, type VerifyTwoFactorOutcome } from '@/auth/AuthProvider';
import { brandColors, radius, spacing } from '@/theme/tokens';

const TWO_FACTOR_CODE_LENGTH = 6;

function isConsumedChallenge(result: VerifyTwoFactorOutcome): boolean {
  if (
    result.kind === 'unauthorized' ||
    result.kind === 'forbidden' ||
    result.kind === 'notFound' ||
    result.kind === 'validation' ||
    result.kind === 'unknown'
  ) {
    return true;
  }
  const serverMessage = result.message?.toLowerCase() ?? '';
  return (
    serverMessage.includes('invalid totp') ||
    serverMessage.includes('already used') ||
    serverMessage.includes('expired session')
  );
}

type TwoFactorErrorCode =
  | 'codeRequired'
  | 'rateLimited'
  | 'expired'
  | 'replay'
  | 'invalidCode'
  | 'network'
  | 'timeout'
  | 'generic';

interface VerificationError {
  /** Stable, locale-independent identity of the error (also the device-E2E testID suffix). */
  code: TwoFactorErrorCode;
  message: string;
}

function localizedError(code: TwoFactorErrorCode, t: (key: string) => string): VerificationError {
  return { code, message: t(`auth.twoFactor.errors.${code}`) };
}

function verificationErrorFor(result: VerifyTwoFactorOutcome, t: (key: string) => string): VerificationError {
  if (result.kind === 'rateLimited') return localizedError('rateLimited', t);
  if (result.kind === 'unauthorized' || result.kind === 'notFound') return localizedError('expired', t);

  const serverMessage = result.message?.toLowerCase() ?? '';
  if (serverMessage.includes('already used')) return localizedError('replay', t);
  if (result.kind === 'validation' || serverMessage.includes('invalid totp')) return localizedError('invalidCode', t);
  if (result.kind === 'network') return localizedError('network', t);
  if (result.kind === 'timeout') return localizedError('timeout', t);
  if (result.kind === 'server') return localizedError('generic', t);
  return { code: 'generic', message: result.message ?? t('auth.twoFactor.errors.generic') };
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, verifyTwoFactor, cancelTwoFactor } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [twoFactorTempToken, setTwoFactorTempToken] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationError, setVerificationError] = useState<VerificationError | null>(null);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [verificationClosed, setVerificationClosed] = useState(false);
  const verificationInFlight = useRef(false);
  const verificationGeneration = useRef(0);

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
        if (result.requires2fa) {
          if (result.tempToken) {
            verificationGeneration.current += 1;
            setTwoFactorTempToken(result.tempToken);
            setVerificationCode('');
            setVerificationError(null);
            setVerificationClosed(false);
          } else {
            setFormError(t('auth.signin.errors.twoFactorRequired'));
          }
        } else {
          setFormError(result.message ?? t('auth.signin.errors.invalidCredentials'));
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!twoFactorTempToken || verificationClosed || verificationInFlight.current) return;

    setVerificationError(null);
    if (!/^\d{6}$/.test(verificationCode)) {
      setVerificationError(localizedError('codeRequired', t));
      return;
    }

    verificationInFlight.current = true;
    setVerificationSubmitting(true);
    const generation = verificationGeneration.current;
    try {
      const result = await verifyTwoFactor(twoFactorTempToken, verificationCode);
      if (generation !== verificationGeneration.current) return;
      if (!result.ok) {
        setVerificationError(verificationErrorFor(result, t));
        if (isConsumedChallenge(result)) {
          // The backend consumes the tempToken before validating the code. Wipe it immediately
          // while retaining the closed screen so the user can see the localized error.
          setTwoFactorTempToken(null);
          setVerificationCode('');
          setVerificationClosed(true);
        }
      }
    } finally {
      verificationInFlight.current = false;
      setVerificationSubmitting(false);
    }
  };

  const handleCancelTwoFactor = () => {
    verificationGeneration.current += 1;
    setTwoFactorTempToken(null);
    setVerificationCode('');
    setVerificationError(null);
    setVerificationClosed(false);
    void cancelTwoFactor();
  };

  if (twoFactorTempToken || verificationClosed) {
    const verificationDisabled = verificationSubmitting || verificationClosed;
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.heading}>{t('auth.twoFactor.title')}</Text>
          <Text style={styles.subheading}>{t('auth.twoFactor.prompt')}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('auth.twoFactor.codeLabel')}</Text>
            <TextInput
              style={styles.input}
              value={verificationCode}
              onChangeText={(value: string) => setVerificationCode(value.replace(/[^0-9]/g, '').slice(0, TWO_FACTOR_CODE_LENGTH))}
              placeholder={t('auth.twoFactor.codePlaceholder')}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={TWO_FACTOR_CODE_LENGTH}
              autoFocus
              editable={!verificationSubmitting && !verificationClosed}
              returnKeyType="done"
              onSubmitEditing={() => void handleVerify()}
              testID="login-2fa-input"
            />
          </View>

          {verificationError ? (
            <Text
              style={styles.errorText}
              accessibilityRole="alert"
              testID={`login-2fa-error-${verificationError.code}`}
            >
              {verificationError.message}
            </Text>
          ) : null}

          <Pressable
            style={[styles.button, verificationDisabled && styles.buttonDisabled]}
            onPress={() => void handleVerify()}
            disabled={verificationDisabled}
            accessibilityState={{ disabled: verificationDisabled }}
            accessibilityRole="button"
            testID="login-2fa-submit-control"
          >
            <View
              testID="login-2fa-submit"
              {...({ disabled: verificationDisabled } as unknown as ComponentProps<typeof View>)}
            >
              {verificationSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('auth.twoFactor.verifyButton')}</Text>
              )}
            </View>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={handleCancelTwoFactor}
            accessibilityRole="button"
            testID="login-2fa-cancel"
          >
            <Text style={styles.secondaryButtonText}>{t('auth.twoFactor.cancel')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
          <Text style={styles.errorText} accessibilityRole="alert" testID="login-error">
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
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.two,
  },
  secondaryButtonText: {
    color: brandColors.primaryDark,
    fontWeight: '600',
    fontSize: 14,
  },
});
