import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/app/components/ui/button';
import { useAuth } from '@/features/auth/AuthProvider';
import BrandLogo from './BrandLogo';

/**
 * Two-factor authentication verification screen.
 *
 * Shown after successful password verification when the user has TOTP enabled.
 * authService.pendingTwoFactor carries the tempToken — if it's absent (direct
 * navigation or stale reload) we bounce back to /signin immediately.
 */
export default function TwoFactorVerify() {
  const navigate = useNavigate();
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
      navigate('/app', { replace: true });
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message ||
        err?.message ||
        'Invalid code. Please try again.'
      );
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
      setError('Please enter all 6 digits.');
      return;
    }
    submitCode(code);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <BrandLogo size="md" variant="dark" />
          <p className="mt-4 text-gray-500 text-sm">Two-factor authentication</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Verify your identity</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            Enter the 6-digit code from your authenticator app.
          </p>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* 6-digit OTP input */}
            <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
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
                  className="w-11 h-13 text-center text-xl font-semibold rounded-xl border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all disabled:opacity-50"
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-white font-semibold text-base"
              style={{ background: 'linear-gradient(135deg, #008040 0%, #00A651 100%)' }}
              disabled={isSubmitting || digits.join('').length < 6}
            >
              {isSubmitting ? 'Verifying…' : 'Verify'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => navigate('/signin', { replace: true })}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
