import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'motion/react';
import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider';
import LanguageToggle from './LanguageToggle';
import BrandLogo from './BrandLogo';
import { signinSchema, type SigninFormData } from '../../features/auth/validation/schemas';

const leftContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
};
const leftItem = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export default function SignIn() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { signin } = useAuth();

  const {
    register,
    handleSubmit,
    setError,
    control,
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
      // 2FA required — authService already stored the tempToken in pendingTwoFactor.
      // Navigate without setting an error so the sign-in form doesn't show a failure.
      if (err?.code === 'REQUIRES_2FA') {
        navigate('/2fa-verify');
        return;
      }
      setError('root', {
        message:
          err.message ||
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
        <motion.div
          className="absolute -top-20 -left-20 w-72 h-72 rounded-full"
          style={{ background: '#fff' }}
          animate={{ scale: [1, 1.05, 1], opacity: [0.10, 0.15, 0.10] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-10 right-[-60px] w-96 h-96 rounded-full"
          style={{ background: '#fff' }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.10, 0.16, 0.10] }}
          transition={{ duration: 9, delay: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full"
          style={{ background: '#fff' }}
          animate={{ scale: [1, 1.03, 1], opacity: [0.05, 0.08, 0.05] }}
          transition={{ duration: 11, delay: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />

        <motion.div
          className="relative z-10"
          variants={leftContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={leftItem}>
            <BrandLogo size="md" variant="light" animated />
          </motion.div>
        </motion.div>

        <motion.div
          className="relative z-10 space-y-8"
          variants={leftContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={leftItem}>
            <p className="text-white/70 text-sm font-medium uppercase tracking-widest mb-3">
              {t('auth.signin.tagline')}
            </p>
            <h2 className="text-white text-4xl font-extrabold leading-tight">
              {t('auth.signin.heading')}
            </h2>
            <p className="mt-4 text-white/70 text-base leading-relaxed">
              {t('auth.signin.subheading')}
            </p>
          </motion.div>

          <motion.div variants={leftItem} className="grid grid-cols-2 gap-4">
            {stats.map(({ stat, label }) => (
              <div key={label} className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <p className="text-white text-xl font-bold">{stat}</p>
                <p className="text-white/70 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </motion.div>

          <motion.div variants={leftItem} className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
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
          </motion.div>
        </motion.div>

        <motion.div
          className="relative z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.5 }}
        >
          <p className="text-white/40 text-xs">© 2025 Easy Moderator · Made in Bangladesh 🇧🇩</p>
        </motion.div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-between mb-8">
            <BrandLogo size="sm" variant="dark" />
            <LanguageToggle variant="dark" />
          </div>

          <div className="hidden lg:flex justify-end mb-4">
            <LanguageToggle variant="dark" />
          </div>

          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="text-3xl font-extrabold text-gray-900">{t('auth.signin.welcomeBack')}</h1>
            <p className="mt-2 text-gray-500 text-sm">{t('auth.signin.loginPrompt')}</p>
          </motion.div>

          <motion.div
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 md:p-8"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <AnimatePresence>
                {errors.root && (
                  <motion.div
                    key="signin-error"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2 overflow-hidden"
                  >
                    <span className="mt-0.5">⚠️</span>
                    <span>{errors.root.message}</span>
                  </motion.div>
                )}
              </AnimatePresence>

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
                <Controller
                  name="rememberMe"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      id="rememberMe"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isSubmitting}
                      className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                    />
                  )}
                />
                <label htmlFor="rememberMe" className="text-sm text-gray-600 cursor-pointer select-none">
                  {t('auth.signin.rememberMe')}
                </label>
              </div>

              <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.1 }}>
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
              </motion.div>
            </form>
          </motion.div>

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
