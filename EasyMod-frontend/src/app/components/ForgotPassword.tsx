import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { apiClient } from '@/api';
import { getErrorMessage } from '@shared/lib/http/errors';
import BrandLogo from './BrandLogo';
import LanguageToggle from './LanguageToggle';
import Seo from './Seo';
import { buildMarketingUrlWithLocale } from '@/app/lib/config';
import './public-funnel.css';

export default function ForgotPassword() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError(t('auth.forgotPassword.errors.emailRequired'));
      return;
    }

    setIsLoading(true);

    try {
      const result = await apiClient.forgotPassword(email.trim());
      setSuccess(result.message || t('auth.forgotPassword.successMessage'));
    } catch (error: unknown) {
      setError(getErrorMessage(error, t('auth.forgotPassword.errors.requestFailed')));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="funnel-page flex flex-col">
      <Seo title={`${t('auth.forgotPassword.title')} | EasyModerator`} description={t('auth.forgotPassword.subtitle')} canonicalPath="/forgot-password" canonicalBase="app" noIndex />
      <header className="flex items-center justify-between border-b border-[#17223B]/10 bg-white px-4 py-3 sm:px-6">
        <a href={buildMarketingUrlWithLocale('/', locale)} aria-label={t('publicFunnel.nav.backToSite')} className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7460D9]">
          <BrandLogo size="sm" variant="dark" />
        </a>
        <LanguageToggle variant="public" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
       <div className="w-full max-w-md">
          <p className="mb-5 text-sm leading-6 text-[#17223B]/70">{t('auth.forgotPassword.subtitle')}</p>

        <div className="rounded-3xl border border-[#17223B]/10 bg-white p-5 shadow-sm sm:p-8">
          <h1 className="mb-6 text-xl font-bold text-[#17223B] sm:text-2xl">{t('auth.forgotPassword.title')}</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}
            {success && (
              <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {success}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-[#17223B]">
                {t('auth.forgotPassword.emailLabel')}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.forgotPassword.emailPlaceholder')}
                autoComplete="email"
                autoFocus
                disabled={isLoading}
                className="h-12 rounded-xl border-[#17223B]/20 focus-visible:ring-[#7460D9]"
              />
            </div>

            <Button
              type="submit"
              className="funnel-button funnel-button-primary h-12 w-full justify-center text-base"
              disabled={isLoading}
            >
              {isLoading ? t('auth.forgotPassword.sending') : t('auth.forgotPassword.sendButton')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/signin"
              className="text-sm font-semibold text-[#5D49BB] hover:underline"
            >
              {t('auth.forgotPassword.backToSignIn')}
            </Link>
          </div>
        </div>
       </div>
      </main>
    </div>
  );
}
