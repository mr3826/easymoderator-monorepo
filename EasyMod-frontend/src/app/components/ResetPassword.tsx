import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { apiClient } from '@/api';
import { getPasswordError } from '@/features/auth/validation/passwordPolicy';
import { getErrorMessage } from '@shared/lib/http/errors';
import BrandLogo from './BrandLogo';
import LanguageToggle from './LanguageToggle';
import Seo from './Seo';
import { buildMarketingUrlWithLocale } from '@/app/lib/config';
import './public-funnel.css';

export default function ResetPassword() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // After a successful reset all existing sessions are invalidated by the backend.
  // Redirect to /signin after a short delay so the user sees the confirmation message.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => navigate('/signin', { replace: true }), 4000);
    return () => clearTimeout(timer);
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      setError(t('auth.resetPassword.errors.missingToken'));
      return;
    }

    // Enforce the same policy the API enforces. The previous 6-character check
    // let through passwords the backend rejects with an opaque 400.
    if (!password || getPasswordError(password)) {
      setError(t('auth.resetPassword.errors.policy'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.resetPassword.errors.mismatch'));
      return;
    }

    setIsLoading(true);

    try {
      await apiClient.resetPassword(token, password);
      setSuccess(t('auth.resetPassword.successMessage'));
      setPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      setError(getErrorMessage(error, t('auth.resetPassword.errors.failed')));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="funnel-page flex flex-col">
      <Seo title={`${t('auth.resetPassword.title')} | EasyModerator`} description={t('auth.resetPassword.subtitle')} canonicalPath="/reset-password" canonicalBase="app" noIndex />
      <header className="flex items-center justify-between border-b border-[#17223B]/10 bg-white px-4 py-3 sm:px-6">
        <a href={buildMarketingUrlWithLocale('/', locale)} aria-label={t('publicFunnel.nav.backToSite')} className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7460D9]">
          <BrandLogo size="sm" variant="dark" />
        </a>
        <LanguageToggle variant="public" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
       <div className="w-full max-w-md">
          <p className="mb-5 text-sm leading-6 text-[#17223B]/70">{t('auth.resetPassword.subtitle')}</p>

        <div className="rounded-3xl border border-[#17223B]/10 bg-white p-5 shadow-sm sm:p-8">
          <h1 className="mb-6 text-xl font-bold text-[#17223B] sm:text-2xl">{t('auth.resetPassword.title')}</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}
            {success && (
              <div role="status" className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <p className="font-medium">{success}</p>
                <p>{t('auth.resetPassword.redirectingNotice')}</p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-semibold text-[#17223B]">
                {t('auth.resetPassword.newPasswordLabel')}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.resetPassword.newPasswordPlaceholder')}
                autoComplete="new-password"
                disabled={isLoading}
                aria-describedby="reset-password-rules"
                className="h-12 rounded-xl border-[#17223B]/20 focus-visible:ring-[#7460D9]"
              />
              <p id="reset-password-rules" className="text-xs leading-5 text-[#17223B]/65">{t('publicFunnel.auth.passwordRules')}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-[#17223B]">
                {t('auth.resetPassword.confirmPasswordLabel')}
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.resetPassword.confirmPasswordPlaceholder')}
                autoComplete="new-password"
                disabled={isLoading}
                className="h-12 rounded-xl border-[#17223B]/20 focus-visible:ring-[#7460D9]"
              />
            </div>

            <Button
              type="submit"
              className="funnel-button funnel-button-primary h-12 w-full justify-center text-base"
              disabled={isLoading}
            >
              {isLoading ? t('auth.resetPassword.resetting') : t('auth.resetPassword.resetButton')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/signin"
              className="text-sm font-semibold text-[#5D49BB] hover:underline"
            >
              {t('auth.resetPassword.backToSignIn')}
            </Link>
          </div>
        </div>
       </div>
      </main>
    </div>
  );
}
