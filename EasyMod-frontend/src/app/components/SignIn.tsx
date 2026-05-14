import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider';
import LanguageToggle from './LanguageToggle';
import { signinSchema, type SigninFormData } from '../../features/auth/validation/schemas';

export default function SignIn() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { signin } = useAuth();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SigninFormData>({
    resolver: zodResolver(signinSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: typeof window !== 'undefined' ? sessionStorage.getItem('rememberMe') === 'true' : false,
    },
  });

  const [showPassword, setShowPassword] = useState(false);

  const stats = t('auth.signin.stats', { returnObjects: true }) as { stat: string; label: string }[];

  const onSubmit = async (data: SigninFormData) => {
    sessionStorage.setItem('rememberMe', data.rememberMe ? 'true' : 'false');
    try {
      await signin({ email: data.email.trim().toLowerCase(), password: data.password });
      navigate('/app');
    } catch (err: any) {
      setError('root', {
        message:
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          t('auth.signin.errors.invalidCredentials'),
      });
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F9FAF8' }}>
      {/* Left panel — brand + trust */}
      <div
        className="hidden lg:flex lg:w-5/12 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #005f30 0%, #00A651 60%, #00c45e 100%)' }}
      >
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full opacity-10" style={{ background: '#fff' }} />
        <div className="absolute bottom-10 right-[-60px] w-96 h-96 rounded-full opacity-10" style={{ background: '#fff' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-5" style={{ background: '#fff' }} />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-lg">E</span>
            </div>
            <span className="text-white text-2xl font-bold tracking-tight">Easy Moderator</span>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <p className="text-white/70 text-sm font-medium uppercase tracking-widest mb-3">
              {t('auth.signin.tagline')}
            </p>
            <h2 className="text-white text-4xl font-extrabold leading-tight">
              {t('auth.signin.heading')}
            </h2>
            <p className="mt-4 text-white/70 text-base leading-relaxed">
              {t('auth.signin.subheading')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {stats.map(({ stat, label }) => (
              <div key={label} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <p className="text-white text-xl font-bold">{stat}</p>
                <p className="text-white/70 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
            <p className="text-white/90 text-sm leading-relaxed italic">
              "{t('auth.signin.testimonialQuote')}"
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/30 flex items-center justify-center text-white text-xs font-bold">
                {t('auth.signin.testimonialName').charAt(0)}
              </div>
              <div>
                <p className="text-white text-xs font-semibold">{t('auth.signin.testimonialName')}</p>
                <p className="text-white/60 text-xs">{t('auth.signin.testimonialShop')}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-white/40 text-xs">© 2025 Easy Moderator · Made in Bangladesh 🇧🇩</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#00A651' }}>
                <span className="text-white font-black text-sm">E</span>
              </div>
              <span className="text-gray-900 text-xl font-bold">Easy Moderator</span>
            </div>
            <LanguageToggle variant="dark" />
          </div>

          <div className="hidden lg:flex justify-end mb-4">
            <LanguageToggle variant="dark" />
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-extrabold text-gray-900">{t('auth.signin.welcomeBack')}</h1>
            <p className="mt-2 text-gray-500 text-sm">{t('auth.signin.loginPrompt')}</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {errors.root && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
                  <span className="mt-0.5">⚠️</span>
                  <span>{errors.root.message}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-sm font-semibold text-gray-700">
                  {t('auth.signin.emailLabel')}
                </label>
                <Input
                  {...register('email')}
                  id="email"
                  type="email"
                  placeholder={t('auth.signin.emailPlaceholder')}
                  autoComplete="email"
                  autoFocus
                  disabled={isSubmitting}
                  className={`h-11 rounded-xl border-gray-200 focus:border-emerald-500 focus:ring-emerald-500/20 ${errors.email ? 'border-red-500' : ''}`}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
                    {t('auth.signin.passwordLabel')}
                  </label>
                  <Link to="/forgot-password" className="text-xs font-medium transition-colors" style={{ color: '#00A651' }}>
                    {t('auth.signin.forgotPassword')}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    {...register('password')}
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth.signin.passwordPlaceholder')}
                    autoComplete="current-password"
                    disabled={isSubmitting}
                    className={`h-11 rounded-xl border-gray-200 pr-11 focus:border-emerald-500 focus:ring-emerald-500/20 ${errors.password ? 'border-red-500' : ''}`}
                  />
                  {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Checkbox
                  {...register('rememberMe')}
                  id="rememberMe"
                  disabled={isSubmitting}
                  className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                />
                <label htmlFor="rememberMe" className="text-sm text-gray-600 cursor-pointer select-none">
                  {t('auth.signin.rememberMe')}
                </label>
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-xl text-white font-semibold text-base shadow-md transition-all hover:shadow-lg hover:opacity-90 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #008040 0%, #00A651 100%)' }}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    {t('auth.signin.signingIn')}
                  </span>
                ) : (
                  t('auth.signin.signInButton')
                )}
              </Button>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              {t('auth.signin.noAccount')}{' '}
              <Link to="/signup" className="font-semibold transition-colors" style={{ color: '#00A651' }}>
                {t('auth.signin.createAccount')}
              </Link>
            </p>
          </div>

          <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <span>🇧🇩</span>
            <span>{t('auth.signin.trustBadge')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
