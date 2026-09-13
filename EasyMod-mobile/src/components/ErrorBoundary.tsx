import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { captureException } from '@/lib/sentry';
import { brandColors, radius, spacing } from '@/theme/tokens';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('mobile.errorBoundary.title')}</Text>
      <Text style={styles.message}>{t('mobile.errorBoundary.message')}</Text>
      <Pressable onPress={onRetry} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('mobile.errorBoundary.retry')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Top-level React error boundary with a friendly, Bengali-first fallback screen. A render crash
 * anywhere below this in the tree shows this screen instead of a white/blank crash, and lets the
 * merchant retry without force-closing the app.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brandColors.background,
    padding: spacing.four,
    gap: spacing.two,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: brandColors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: brandColors.text,
    textAlign: 'center',
    opacity: 0.8,
  },
  button: {
    marginTop: spacing.three,
    backgroundColor: brandColors.primary,
    paddingHorizontal: spacing.four,
    paddingVertical: spacing.two,
    borderRadius: radius.default,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
