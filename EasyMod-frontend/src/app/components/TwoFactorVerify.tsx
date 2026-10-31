import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/app/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import BrandLogo from './BrandLogo';
import LanguageToggle from './LanguageToggle';
import Seo from './Seo';
import { getErrorMessage } from '@shared/lib/http/errors';
import './public-funnel.css';

/**
 * Two-factor authentication verification screen.
 *
 * Shown after successful password verification when the user has TOTP enabled.
 * authService.pendingTwoFactor carries the tempToken — if it's absent (direct
 * navigation or stale reload) we bounce back to /signin immediately.
 */
export default function TwoFactorVerify() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { pendingTwoFactor, verifyTwoFactor } = useAuth();

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Guard: if there's no pending 2FA session, go back to sign-in.
  useEffect(() => {
    if (!pendingTwoFactor) {
      navigate('/signin', { replace: true });
    }
  }, [pendingTwoFactor, navigate]);

  const handleDigitChange = (index: number, value: string) => {
    // Only accept a single digit 0-9
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError('');

    // Advance focus to next input on digit entry
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are filled
    if (digit && index === 5) {
      const code = [...next].join('');
      if (code.length === 6) {
        submitCode(code);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    const next = [...digits];
    text.split('').forEach((ch, i) => {
      if (i < 6) next[i] = ch;
    });
    setDigits(next);
    const filled = text.length - 1;
    inputRefs.current[Math.min(filled, 5)]?.focus();
    if (text.length === 6) {
      submitCode(text);
    }
  };

  const submitCode = async (code: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      await verifyTwoFactor(code);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(getErrorMessage(err, t('publicFunnel.auth.twoFactorInvalidCode')));
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('');
    if (code.length < 6) {
      setError(t('publicFunnel.auth.twoFactorEnterAllDigits'));
      return;
    }
    submitCode(code);
  };

  return (
    <div className="funnel-page flex flex-col">
      <Seo title={t('publicFunnel.auth.twoFactorTitle')} description={t('publicFunnel.auth.twoFactorDescription')} canonicalPath="/2fa-verify" canonicalBase="app" noIndex />
      <header className="flex items-center justify-end border-b border-[#17223B]/10 bg-white px-4 py-3 sm:px-6">
        <LanguageToggle variant="public" />
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
       <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-[#17223B]/10 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <BrandLogo size="md" variant="dark" />
          </div>
          <h1 className="mb-1 text-center text-xl font-bold text-[#17223B]">{t('publicFunnel.auth.twoFactorHeading')}</h1>
          <p className="mb-6 text-center text-sm text-[#17223B]/70">
            {t('publicFunnel.auth.twoFactorDescription')}
          </p>

          {error && (
            <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* 6-digit OTP input */}
            <div className="mb-6 flex justify-center gap-1.5 sm:gap-2" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={isSubmitting}
                  autoFocus={i === 0}
                  className="h-12 w-9 rounded-xl border border-[#17223B]/20 text-center text-xl font-semibold text-[#17223B] outline-none transition-all focus:border-[#7460D9] focus:ring-2 focus:ring-[#7460D9]/20 disabled:opacity-50 sm:w-11"
                  aria-label={t('publicFunnel.auth.twoFactorDigit', { count: i + 1 })}
                />
              ))}
            </div>

            <Button
              type="submit"
              className="funnel-button funnel-button-primary h-12 w-full justify-center text-base"
              disabled={isSubmitting || digits.join('').length < 6}
            >
              {isSubmitting ? t('publicFunnel.auth.twoFactorVerifying') : t('publicFunnel.auth.twoFactorVerify')}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => navigate('/signin', { replace: true })}
              className="text-sm font-semibold text-[#5D49BB] hover:underline"
            >
              {t('publicFunnel.auth.twoFactorBack')}
            </button>
          </div>
        </div>
       </div>
      </main>
    </div>
  );
}
