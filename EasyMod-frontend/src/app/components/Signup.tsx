import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from "motion/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { useAuth } from "../../features/auth/AuthProvider";
import { apiClient } from "@/api";
import { subscriptionPlans, getPlanPrice } from "../lib/subscriptionPlans";
import LanguageToggle from "./LanguageToggle";
import BrandLogo from "./BrandLogo";
import { signupSchema, type SignupFormData } from '../../features/auth/validation/schemas';
import { PasswordStrengthMeter } from '../../features/auth/components/PasswordStrengthMeter';

const heroVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};
const heroChild = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const featureStripVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.5 } },
};
const featureChild = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export default function Signup() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { signup } = useAuth();
  const [billingAnnual, setBillingAnnual] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("PACKAGE_1");

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      acceptedTerms: false,
    },
  });

  const passwordValue = watch('password');

  const selectedPlan = useMemo(
    () => subscriptionPlans.find((plan) => plan.id === selectedPlanId) ?? subscriptionPlans[0],
    [selectedPlanId]
  );

  const formatPrice = (value: number) => `৳${value.toLocaleString()}`;

  const onSubmit = async (data: SignupFormData) => {
    const billingCycle = billingAnnual ? "yearly" : "monthly";
    try {
      await signup({
        email: data.email,
        password: data.password,
        full_name: data.fullName,
        phone: data.phone?.trim() || undefined,
      });

      await apiClient.subscribeToPlan(selectedPlan.id, billingCycle);

      sessionStorage.setItem(
        "easymod_selected_plan",
        JSON.stringify({
          planId: selectedPlan.id,
          billing: billingAnnual ? "annual" : "monthly",
        })
      );

      navigate("/app");
    } catch (err: any) {
      setError('root', {
        message:
          err.message ||
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          t('auth.signup.errors.unableToCreate'),
      });
    }
  };

  const signupFeatures = [
    { icon: '🛡️', title: t('auth.signup.features.rtoShield.title'), desc: t('auth.signup.features.rtoShield.desc') },
    { icon: '🚚', title: t('auth.signup.features.delivery.title'), desc: t('auth.signup.features.delivery.desc') },
    { icon: '💬', title: t('auth.signup.features.chatbot.title'), desc: t('auth.signup.features.chatbot.desc') },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F9FAF8' }}>
      {/* Top bar */}
      <motion.header
        className="bg-white border-b border-gray-100 px-6 py-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <BrandLogo size="sm" variant="dark" />
          <div className="flex items-center gap-4">
            <LanguageToggle variant="dark" />
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{t('auth.signup.alreadyHaveAccount')}</span>
              <Link to="/signin" className="font-semibold transition-colors" style={{ color: '#00A651' }}>
                {t('auth.signup.signIn')}
              </Link>
            </div>
          </div>
        </div>
      </motion.header>

      <div className="max-w-7xl mx-auto px-4 py-10">
        <motion.div
          className="text-center mb-10"
          variants={heroVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div
            variants={heroChild}
            className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 text-sm text-emerald-700 font-medium mb-4"
          >
            {t('auth.signup.badge')}
          </motion.div>
          <motion.h1 variants={heroChild} className="text-4xl font-extrabold text-gray-900">
            {t('auth.signup.heading')}
          </motion.h1>
          <motion.p variants={heroChild} className="mt-2 text-gray-500 text-base max-w-md mx-auto">
            {t('auth.signup.subheading')}
          </motion.p>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Left — plan selection */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{t('auth.signup.choosePlan')}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{t('auth.signup.annualSavings')}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-medium ${!billingAnnual ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t('auth.signup.monthly')}
                  </span>
                  <Switch
                    checked={billingAnnual}
                    onCheckedChange={(value: boolean) => setBillingAnnual(value)}
                    aria-label="Toggle annual billing"
                    className="data-[state=checked]:bg-emerald-600"
                  />
                  <span className={`font-medium ${billingAnnual ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t('auth.signup.annual')}
                  </span>
                  <AnimatePresence>
                    {billingAnnual && (
                      <motion.span
                        key="savings-badge"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2 }}
                        className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full"
                      >
                        {t('auth.signup.twoMonthsFree')}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {subscriptionPlans.map((plan, i) => {
                  const isSelected = plan.id === selectedPlanId;
                  const price = getPlanPrice(plan, billingAnnual ? "yearly" : "monthly");
                  return (
                    <motion.button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`flex flex-col rounded-2xl border-2 p-5 text-left transition-colors duration-200 ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 shadow-md ring-1 ring-emerald-500/20'
                          : 'border-gray-150 bg-white hover:border-emerald-300 hover:shadow-sm'
                      }`}
                      style={{ borderColor: isSelected ? '#00A651' : undefined }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={!isSelected ? { y: -4, boxShadow: "0 8px 24px rgba(0,166,81,0.12)" } : {}}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="flex items-start justify-between gap-1 mb-3">
                        <p className="text-base font-bold text-gray-900">{plan.name}</p>
                        {plan.popular && (
                          <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                            {t('auth.signup.popular')}
                          </span>
                        )}
                      </div>

                      <div className="flex items-end gap-1 mb-1">
                        <span className="text-2xl font-extrabold text-gray-900">{formatPrice(price)}</span>
                        <span className="text-xs text-gray-400 pb-1">{t('auth.signup.perMonth')}</span>
                      </div>
                      <p className="text-xs text-gray-400 mb-4">
                        {billingAnnual ? t('auth.signup.annualBilling') : t('auth.signup.monthlyBilling')}
                      </p>

                      <ul className="space-y-1.5 text-xs text-gray-600 flex-1">
                        {plan.highlights.map((feature) => (
                          <li key={feature} className="flex items-start gap-2">
                            <span className="mt-0.5 text-emerald-500 font-bold">✓</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {isSelected && (
                        <div className="mt-4 pt-3 border-t border-emerald-200 text-xs font-semibold text-emerald-700 flex items-center gap-1">
                          {t('auth.signup.selectedPlan')}
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* BD features strip */}
            <motion.div
              className="mt-4 grid grid-cols-3 gap-3"
              variants={featureStripVariants}
              initial="hidden"
              animate="visible"
            >
              {signupFeatures.map(({ icon, title, desc }) => (
                <motion.div
                  key={title}
                  variants={featureChild}
                  className="bg-white rounded-xl border border-gray-100 p-3 flex items-start gap-2.5"
                >
                  <span className="text-xl">{icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{title}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right — account form */}
          <motion.div
            className="w-full lg:w-[400px] shrink-0"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-1">{t('auth.signup.createAccountHeading')}</h2>
              <p className="text-sm text-gray-500 mb-5">
                <span className="font-medium" style={{ color: '#00A651' }}>{selectedPlan.name}</span>{' '}
                {t('auth.signup.activatePlan')}
              </p>

              <AnimatePresence>
                {errors.root && (
                  <motion.div
                    key="signup-error"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2 overflow-hidden"
                  >
                    <span>⚠️</span><span>{errors.root.message}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700" htmlFor="fullName">
                    {t('auth.signup.fullName')}
                  </label>
                  <Input
                    {...register('fullName')}
                    id="fullName"
                    placeholder={t('auth.signup.fullNamePlaceholder')}
                    autoComplete="name"
                    disabled={isSubmitting}
                    className={`h-11 rounded-xl border-gray-200 focus:border-emerald-500 ${errors.fullName ? 'border-red-500' : ''}`}
                  />
                  {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700" htmlFor="email">
                    {t('auth.signup.email')}
                  </label>
                  <Input
                    {...register('email')}
                    id="email"
                    type="email"
                    placeholder={t('auth.signup.emailPlaceholder')}
                    autoComplete="email"
                    disabled={isSubmitting}
                    className={`h-11 rounded-xl border-gray-200 focus:border-emerald-500 ${errors.email ? 'border-red-500' : ''}`}
                  />
                  {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700" htmlFor="phone">
                    {t('auth.signup.phone')}
                    <span className="ml-1 text-xs text-gray-400 font-normal">{t('auth.signup.optional')}</span>
                  </label>
                  <Input
                    {...register('phone')}
                    id="phone"
                    placeholder="+8801XXXXXXXXX"
                    autoComplete="tel"
                    disabled={isSubmitting}
                    className={`h-11 rounded-xl border-gray-200 focus:border-emerald-500 ${errors.phone ? 'border-red-500' : ''}`}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700" htmlFor="password">
                    {t('auth.signup.password')}
                  </label>
                  <Input
                    {...register('password')}
                    id="password"
                    type="password"
                    placeholder={t('auth.signup.passwordPlaceholder')}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                    className={`h-11 rounded-xl border-gray-200 focus:border-emerald-500 ${errors.password ? 'border-red-500' : ''}`}
                  />
                  {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
                  <PasswordStrengthMeter password={passwordValue || ''} />
                </div>

                {/* BD Payment section — BKash only */}
                <div className="rounded-xl border border-dashed border-pink-200 bg-pink-50 p-4">
                  <p className="text-xs font-semibold text-gray-700 mb-2">সাবস্ক্রিপশন পেমেন্ট পদ্ধতি</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-pink-100 text-pink-700 border-pink-200">
                      bKash
                    </span>
                  </div>
                </div>

                {/* Terms */}
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    {...register('acceptedTerms')}
                    id="terms"
                    disabled={isSubmitting}
                    className="mt-0.5 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                  />
                  <label htmlFor="terms" className="text-xs text-gray-600 leading-relaxed">
                    {t('auth.signup.agreePrefix')}{' '}
                    <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-medium underline" style={{ color: '#00A651' }}>
                      {t('auth.signup.privacyPolicy')}
                    </a>{' '}
                    {t('auth.signup.agreeSuffix')}{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium underline" style={{ color: '#00A651' }}>
                      Terms of Service
                    </a>
                  </label>
                </div>
                {errors.acceptedTerms && <p className="text-red-500 text-xs">{errors.acceptedTerms.message}</p>}

                {/* Order summary */}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>{t('auth.signup.plan')}</span>
                    <span className="font-semibold text-gray-900">{selectedPlan.name}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>{t('auth.signup.billing')}</span>
                    <span className="font-semibold text-gray-900">
                      {billingAnnual ? t('auth.signup.annual') : t('auth.signup.monthly')}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between">
                    <span className="text-gray-700 font-medium">{t('auth.signup.payToday')}</span>
                    <span className="font-bold text-emerald-600">{t('auth.signup.devModeAmount')}</span>
                  </div>
                </div>

                <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.1 }}>
                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl text-white font-bold text-base shadow-md transition-all hover:shadow-lg hover:opacity-90 disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #008040 0%, #00A651 100%)' }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        {t('auth.signup.creating')}
                      </span>
                    ) : (
                      t('auth.signup.createButton')
                    )}
                  </Button>
                </motion.div>
              </form>

              <div className="mt-4 text-center text-xs text-gray-400">
                {t('auth.signup.secure')}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
