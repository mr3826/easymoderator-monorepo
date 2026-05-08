import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { apiClient } from '@/api';

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      setError(t('auth.resetPassword.errors.missingToken'));
      return;
    }

    if (!password || password.length < 6) {
      setError(t('auth.resetPassword.errors.minLength'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.resetPassword.errors.mismatch'));
      return;
    }

    setIsLoading(true);

    try {
      const result = await apiClient.resetPassword(token, password);
      setSuccess(result.message || t('auth.resetPassword.successMessage'));
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setError(
        error.response?.data?.error?.message ||
          error.response?.data?.message ||
          t('auth.resetPassword.errors.failed')
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl"></div>
            <span className="text-3xl font-bold text-gray-900">Easy Moderator</span>
          </div>
          <p className="text-gray-600">{t('auth.resetPassword.subtitle')}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 md:p-8">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">{t('auth.resetPassword.title')}</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                {success}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
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
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
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
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              disabled={isLoading}
            >
              {isLoading ? t('auth.resetPassword.resetting') : t('auth.resetPassword.resetButton')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/signin"
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
            >
              {t('auth.resetPassword.backToSignIn')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
