import { Receipt, AlertCircle, CheckCircle2, Download, Eye, TrendingUp, Package, ShoppingCart, MessageSquare, CreditCard, Clock } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { Progress } from "@/app/components/ui/progress";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { toast } from "sonner";
import { apiClient } from "@/api";
import { subscriptionPlans, getPlanPrice, findPlanByName, type BillingCycle } from "@/app/lib/subscriptionPlans";
import { FeatureGate } from "@/app/components/FeatureGate";
import { UsageMeter } from "./billing/UsageMeter";
import { BKashCheckout } from "./billing/BKashCheckout";
import { PlanComparison } from "./billing/PlanComparison";

interface Invoice {
  id: string;       // invoice_number (displayed)
  rawId: string;    // UUID (used for API calls)
  billingPeriod: string;
  amount: number;
  status: 'pending' | 'paid';
  type: string;
  date: string;
}

export default function Subscription() {
  const { t } = useTranslation();
  const [selectedConversationPack, setSelectedConversationPack] = useState<number | null>(null);
  const [isRequestingInvoice, setIsRequestingInvoice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasSubscriptionData, setHasSubscriptionData] = useState(true);
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(subscriptionPlans[1]?.id || "PACKAGE_1");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  // State for actual data from API
  const [currentPlan, setCurrentPlan] = useState({
    name: 'Free',
    price: 0,
    cycle: 'Monthly',
    nextBillingDate: '',
    status: 'active',
    features: {
      imageUnderstanding: false,
    }
  });

  const [billingPeriodStart, setBillingPeriodStart] = useState<string | null>(null);

  const [usage, setUsage] = useState({
    conversations: {
      used: 0,
      limit: 100,
      status: 'safe' as 'safe' | 'warning' | 'exceeded'
    },
    orders: {
      used: 0,
      limit: 50,
      status: 'safe' as 'safe' | 'warning' | 'exceeded'
    },
    products: {
      used: 0,
      limit: 100,
      status: 'safe' as 'safe' | 'warning' | 'exceeded'
    }
  });

  const [extraUsage, setExtraUsage] = useState({
    conversations: 0,
    estimatedCharge: 0
  });

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [shownThresholds, setShownThresholds] = useState<Set<number>>(new Set());

  // Forecast: days until conversations limit hit at current burn rate
  const conversationForecastDays = (() => {
    if (!billingPeriodStart) return null;
    const { used, limit } = usage.conversations;
    if (limit < 0 || used === 0) return null;
    const start = new Date(billingPeriodStart);
    const now = new Date();
    const daysElapsed = Math.max(1, (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const burnRate = used / daysElapsed;
    if (burnRate === 0) return null;
    const remaining = limit - used;
    if (remaining <= 0) return 0;
    return Math.floor(remaining / burnRate);
  })();

  // Fire in-app notification when conversation usage crosses 50 / 75 / 90 %
  useEffect(() => {
    const { used, limit } = usage.conversations;
    if (limit <= 0) return;
    const pct = (used / limit) * 100;
    const thresholds = [50, 75, 90];
    for (const threshold of thresholds) {
      if (pct >= threshold && !shownThresholds.has(threshold)) {
        const isOver90 = threshold === 90;
        toast[isOver90 ? 'error' : 'warning'](
          `আপনি মাসিক conversation limit-এর ${threshold}% ব্যবহার করেছেন (${used}/${limit})।${
            isOver90 ? ' Upgrade করুন বা extra pack কিনুন।' : ''
          }`,
          { duration: 8000, id: `conv-limit-${threshold}` }
        );
        setShownThresholds((prev) => new Set([...prev, threshold]));
      }
    }
  }, [usage.conversations]);

  // Load subscription data on mount; handle payment return from gateway
  useEffect(() => {
    loadSubscriptionData();
    loadInvoices();

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    if (paymentStatus === 'success') {
      setSuccess('Payment successful! Your conversation credits have been added.');
      setTimeout(() => setSuccess(null), 8000);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'failed') {
      setError('Payment was not completed. Please try again.');
      setTimeout(() => setError(null), 8000);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const loadSubscriptionData = async () => {
    try {
      setLoading(true);
      setHasSubscriptionData(true);
      const data = await apiClient.getSubscription() as any;

      if (!data?.subscription) {
        setHasSubscriptionData(false);
        return;
      }

      {
        const { subscription, usage: usageData, extra_usage } = data;
        
        // Update current plan
        setCurrentPlan({
          name: subscription.plan_name,
          price: parseFloat(subscription.plan_price),
          cycle: subscription.billing_cycle === 'monthly' ? 'Monthly' : 'Yearly',
          nextBillingDate: new Date(subscription.next_billing_date).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }),
          status: subscription.status,
          features: {
            imageUnderstanding: subscription.features?.image_understanding || false
          }
        });

        const matchedPlan = findPlanByName(subscription.plan_name);
        if (matchedPlan) {
          setSelectedPlanId(matchedPlan.id);
        }
        setBillingCycle(subscription.billing_cycle === 'yearly' ? 'yearly' : 'monthly');
        setTrialEndsAt(subscription.trial_ends_at || null);
        setBillingPeriodStart(subscription.current_period_start || subscription.created_at || null);

        // Update usage
        setUsage({
          conversations: {
            used: usageData.conversations.used,
            limit: usageData.conversations.limit,
            status: usageData.conversations.status
          },
          orders: {
            used: usageData.orders.used,
            limit: usageData.orders.limit,
            status: usageData.orders.status
          },
          products: {
            used: usageData.products.used,
            limit: usageData.products.limit,
            status: usageData.products.status
          }
        });

        // Update extra usage
        setExtraUsage({
          conversations: extra_usage.conversations,
          estimatedCharge: extra_usage.charge
        });
      }
    } catch (error: any) {
      console.error('Failed to load subscription data:', error);
      setError('Failed to load subscription data');
      setHasSubscriptionData(false);
    } finally {
      setLoading(false);
    }
  };

  const loadInvoices = async () => {
    try {
      const invoices = await apiClient.getSubscriptionInvoices() as any[];

      if (Array.isArray(invoices) && invoices.length > 0) {
        const mappedInvoices = invoices.map((inv: any) => ({
          id: inv.invoice_number,
          rawId: inv.id,
          billingPeriod: inv.billing_period,
          amount: parseFloat(inv.amount),
          status: inv.status,
          type: inv.invoice_type,
          date: new Date(inv.created_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          })
        }));
        setInvoices(mappedInvoices);
      } else {
        setInvoices([]);
      }
    } catch (error: any) {
      console.error('Failed to load invoices:', error);
      toast.error('Failed to load invoices');
      setInvoices([]);
    }
  };

  const planFeatures = [
    'Image-based product understanding',
    'Product question answering',
    'Order draft creation',
    'Cash on Delivery support'
  ];

  const conversationPacks = [
    { amount: 100, price: 250 },
    { amount: 300, price: 675 },
    { amount: 500, price: 1000 }
  ];

  const getUsagePercentage = (used: number, limit: number) => {
    return Math.min((used / limit) * 100, 100);
  };

  const getStatusColor = (status: 'safe' | 'warning' | 'exceeded') => {
    switch (status) {
      case 'safe':
        return 'text-green-600 bg-green-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      case 'exceeded':
        return 'text-orange-600 bg-orange-50';
    }
  };

  const getStatusLabel = (status: 'safe' | 'warning' | 'exceeded') => {
    switch (status) {
      case 'safe':
        return t('subscription.statusSafe');
      case 'warning':
        return t('subscription.statusAlmostUsed');
      case 'exceeded':
        return t('subscription.statusExtra');
    }
  };

  const getTrialDaysRemaining = () => {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    if (ms <= 0) return null;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  };

  const calculateTotalBill = () => {
    let total = currentPlan.price;
    if (usage.conversations.status === 'exceeded') {
      total += extraUsage.estimatedCharge;
    }
    if (selectedConversationPack) {
      const pack = conversationPacks.find(p => p.amount === selectedConversationPack);
      if (pack) total += pack.price;
    }
    return total;
  };

  const handlePlanUpdate = async (planId: string) => {
    const selectedPlan = subscriptionPlans.find((plan) => plan.id === planId);
    if (!selectedPlan) return;

    try {
      setIsUpdatingPlan(true);
      setError(null);
      setSuccess(null);

      const response = await apiClient.subscribeToPlan(selectedPlan.id, billingCycle);

      if (response?.success) {
        setSuccess(response.message || 'Subscription plan updated successfully');
        loadSubscriptionData();
        setTimeout(() => setSuccess(null), 5000);
      }
    } catch (error: any) {
      setError(error.response?.data?.error?.message || 'Failed to update plan');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  const handleRequestConversationPack = async () => {
    if (!selectedConversationPack) return;

    try {
      setIsRequestingInvoice(true);
      setError(null);
      setSuccess(null);

      const pack = conversationPacks.find(p => p.amount === selectedConversationPack);
      if (!pack) return;

      const invoiceRes = await apiClient.purchaseConversationPack({
        amount: selectedConversationPack,
        price: pack.price
      });

      if (!invoiceRes.success || !invoiceRes.data?.id) {
        throw new Error(invoiceRes.message || 'Failed to create invoice');
      }

      setSuccess(`Invoice created (${invoiceRes.data.invoice_number || ''}). Please pay ৳${pack.price.toLocaleString()} via bKash/bank transfer and contact support@easymod.ai to activate your pack.`);
      setTimeout(() => setSuccess(null), 10000);
    } catch (error: any) {
      setError(error.response?.data?.error?.message || error.message || 'Failed to create invoice');
      setTimeout(() => setError(null), 6000);
    } finally {
      setIsRequestingInvoice(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">{t('subscription.loading')}</div>
        </div>
      </div>
    );
  }

  if (!hasSubscriptionData) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl p-8 border border-gray-200 shadow-sm text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('subscription.noData')}</h2>
          <p className="text-gray-600 mb-6">
            {t('subscription.noDataMsg')}
          </p>
          <button
            onClick={() => loadSubscriptionData()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('subscription.reload')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('subscription.title')}</h1>
        <p className="text-gray-600 mt-1 text-sm md:text-base">{t('subscription.subtitle')}</p>
      </div>

      {/* Trial countdown banner */}
      {(() => {
        const days = getTrialDaysRemaining();
        if (days === null) return null;
        const urgent = days <= 3;
        return (
          <div className={`mb-4 flex items-center gap-3 px-4 py-3 rounded-lg border ${
            urgent
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            <Clock className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">
                {urgent ? `⚠️ Trial ends in ${days} day${days === 1 ? '' : 's'}!` : `Trial: ${days} days remaining`}
              </span>
              <span className="ml-2 text-sm">
                {urgent
                  ? 'Upgrade now to keep your conversations and data.'
                  : 'Enjoying Easy Moderator? Pick a plan before your trial ends.'}
              </span>
            </div>
            <button
              onClick={() => document.getElementById('plans-section')?.scrollIntoView({ behavior: 'smooth' })}
              className={`text-sm font-medium underline whitespace-nowrap ${urgent ? 'text-red-700' : 'text-amber-700'}`}
            >
              View plans
            </button>
          </div>
        );
      })()}

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {/* Section 1: Current Plan Overview */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 mb-6 shadow-sm">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">{t('subscription.planTitle', { plan: currentPlan.name })}</h2>
              <Badge className={`${currentPlan.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                {currentPlan.status === 'active' ? t('common.active') : t('common.inactive')}
              </Badge>
              {currentPlan.features.imageUnderstanding && (
                <Badge className="bg-blue-100 text-blue-700">{t('subscription.imageUnderstanding')}</Badge>
              )}
            </div>
            <div className="space-y-1 text-gray-600">
              <p className="text-lg">{t('subscription.price', { price: currentPlan.price.toLocaleString(), cycle: currentPlan.cycle })}</p>
              <p className="text-sm">{t('subscription.nextBilling', { date: currentPlan.nextBillingDate })}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              {t('subscription.addConversations')}
            </button>
            <button className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              {t('subscription.upgradePlan')}
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Available Plans */}
      <div id="plans-section" className="bg-white rounded-xl p-6 border border-gray-200 mb-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{t('subscription.plansTitle')}</h2>
            <p className="text-sm text-gray-500">{t('subscription.plansSubtitle')}</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span className={billingCycle === 'monthly' ? 'font-semibold text-gray-900' : ''}>
              {t('subscription.monthly')}
            </span>
            <Switch
              checked={billingCycle === 'yearly'}
              onCheckedChange={(value) => setBillingCycle(value ? 'yearly' : 'monthly')}
              aria-label="Toggle annual billing"
            />
            <span className={billingCycle === 'yearly' ? 'font-semibold text-gray-900' : ''}>
              {t('subscription.annual')}
            </span>
            <Badge className="bg-emerald-100 text-emerald-700">{t('subscription.twoMonthsFree')}</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {subscriptionPlans.map((plan) => {
            const isActive = plan.name.toLowerCase() === currentPlan.name.toLowerCase();
            const price = getPlanPrice(plan, billingCycle);

            return (
              <div
                key={plan.id}
                className={`flex h-full flex-col rounded-xl border p-5 ${
                  plan.id === selectedPlanId
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{plan.name}</p>
                    <p className="text-sm text-gray-500">{plan.description}</p>
                  </div>
                  {plan.popular && (
                    <Badge className="bg-purple-100 text-purple-700">Popular</Badge>
                  )}
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">৳{price.toLocaleString()}</span>
                  <span className="text-sm text-gray-500">/mo</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {billingCycle === 'yearly' ? t('subscription.billedAnnually') : t('subscription.billedMonthly')}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  {plan.highlights.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-600" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 space-y-1 text-xs text-gray-500">
                  <div>Conversations: {plan.limits.conversations < 0 ? 'Unlimited' : `${plan.limits.conversations.toLocaleString()}/mo`}</div>
                  <div>Orders: {plan.limits.orders < 0 ? 'Unlimited' : `${plan.limits.orders.toLocaleString()}/mo`}</div>
                  <div>Products: {plan.limits.products < 0 ? 'Unlimited' : plan.limits.products.toLocaleString()}</div>
                </div>
                <div className="mt-auto pt-5">
                  {isActive ? (
                    <button className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600" disabled>
                      {t('subscription.currentPlan')}
                    </button>
                  ) : plan.id === 'partner' ? (
                    <a
                      href="/pricing"
                      className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 text-center block"
                    >
                      আবেদন করুন →
                    </a>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedPlanId(plan.id);
                        handlePlanUpdate(plan.id);
                      }}
                      disabled={isUpdatingPlan}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {isUpdatingPlan && plan.id === selectedPlanId ? t('common.updating') : t('subscription.switchPlan')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Usage Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* AI Conversations */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('subscription.aiConversations')}</h3>
          </div>
          <div className="mb-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900">{usage.conversations.used.toLocaleString()}</span>
              <span className="text-gray-500">
                {usage.conversations.limit < 0
                  ? '/ Unlimited'
                  : `/ ${usage.conversations.limit.toLocaleString()}/mo`}
              </span>
            </div>
            {usage.conversations.limit > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {Math.round((usage.conversations.used / usage.conversations.limit) * 100)}% ব্যবহার হয়েছে
              </p>
            )}
          </div>
          {usage.conversations.limit > 0 && (
            <div className="relative mb-3">
              <Progress
                value={getUsagePercentage(usage.conversations.used, usage.conversations.limit)}
                className="h-2"
              />
              {/* Threshold tick marks */}
              <div className="flex justify-between mt-1 px-0.5">
                {[50, 75, 90].map((pct) => {
                  const reached = usage.conversations.limit > 0 && (usage.conversations.used / usage.conversations.limit) * 100 >= pct;
                  return (
                    <span
                      key={pct}
                      style={{ marginLeft: `${pct}%`, position: 'absolute', transform: 'translateX(-50%)' }}
                      className={`text-[10px] font-medium ${reached ? 'text-orange-500' : 'text-gray-300'}`}
                    >
                      {pct}%
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {usage.conversations.limit < 0 && (
            <Progress value={0} className="h-2 mb-3" />
          )}
          <div className="flex items-center justify-between mt-4">
            <Badge className={getStatusColor(usage.conversations.status)}>
              {getStatusLabel(usage.conversations.status)}
            </Badge>
          </div>
          {usage.conversations.status === 'exceeded' && (
            <p className="text-xs text-gray-500 mt-3">
              {t('subscription.extraUsageNote')}
            </p>
          )}
          {conversationForecastDays !== null && conversationForecastDays <= 7 && usage.conversations.status !== 'exceeded' && (
            <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <TrendingUp className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-800 font-medium">
                {conversationForecastDays === 0
                  ? 'আপনি limit এ পৌঁছে গেছেন!'
                  : `এই হারে চললে ${conversationForecastDays} দিনের মধ্যে limit শেষ হবে।`}
                {' '}
                <span className="underline cursor-pointer">Extra pack কিনুন</span>
              </p>
            </div>
          )}
        </div>

        {/* Orders Created */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('subscription.ordersCreated')}</h3>
          </div>
          <div className="mb-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900">{usage.orders.used.toLocaleString()}</span>
              <span className="text-gray-500">{t('subscription.usagePerMonth', { used: usage.orders.used.toLocaleString(), limit: usage.orders.limit.toLocaleString() })}</span>
            </div>
          </div>
          <Progress 
            value={getUsagePercentage(usage.orders.used, usage.orders.limit)} 
            className="h-2 mb-3"
          />
          <div className="flex items-center justify-between">
            <Badge className={getStatusColor(usage.orders.status)}>
              {getStatusLabel(usage.orders.status)}
            </Badge>
          </div>
        </div>

        {/* Products Used */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <Package className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('subscription.productsUsed')}</h3>
          </div>
          <div className="mb-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900">{usage.products.used.toLocaleString()}</span>
              <span className="text-gray-500">{t('subscription.usagePerMonth', { used: usage.products.used.toLocaleString(), limit: usage.products.limit.toLocaleString() })}</span>
            </div>
          </div>
          <Progress 
            value={getUsagePercentage(usage.products.used, usage.products.limit)} 
            className="h-2 mb-3"
          />
          <div className="flex items-center justify-between">
            <Badge className={getStatusColor(usage.products.status)}>
              {getStatusLabel(usage.products.status)}
            </Badge>
          </div>
        </div>
      </div>

      {/* Section 3: Extra Usage Notice (Conditional) */}
      {usage.conversations.status === 'exceeded' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-yellow-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('subscription.extraAlert')}</h3>
              <p className="text-gray-700 mb-4">
                {t('subscription.extraAlertMsg', { count: extraUsage.conversations })}
              </p>
              <div className="bg-white rounded-lg p-4 border border-yellow-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t('subscription.extraCount')}</span>
                  <span className="font-semibold text-gray-900">{extraUsage.conversations} conversations</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t('subscription.extraCharge')}</span>
                  <span className="font-semibold text-gray-900">৳{extraUsage.estimatedCharge.toLocaleString()} BDT</span>
                </div>
              </div>
              <p className="text-sm text-gray-600 mt-3">
                {t('subscription.nextInvoiceNote')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Section 4: Add More Conversations */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('subscription.addConversationsTitle')}</h3>
          <div className="space-y-3 mb-6">
            {conversationPacks.map((pack) => (
              <button
                key={pack.amount}
                onClick={() => setSelectedConversationPack(pack.amount)}
                className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                  selectedConversationPack === pack.amount
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">+{pack.amount} conversations</p>
                    <p className="text-xs text-gray-500 mt-1">মাসিক limit-এ যোগ হবে</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">৳{pack.price.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">BDT</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={handleRequestConversationPack}
            disabled={!selectedConversationPack || isRequestingInvoice}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors ${
              selectedConversationPack && !isRequestingInvoice
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            {isRequestingInvoice ? 'Creating invoice...' : t('subscription.requestInvoice')}
          </button>
          <p className="text-xs text-gray-500 text-center mt-3">
            {t('subscription.invoiceNote')}
          </p>
        </div>

        {/* Section 5: Feature Access */}
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('subscription.planIncludes')}</h3>
          <div className="space-y-3 mb-5">
            {(t('subscription.planFeatures', { returnObjects: true }) as string[]).map((feature, index) => (
              <div key={index} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700">{feature}</span>
              </div>
            ))}
          </div>
          {/* Contextual upgrade gates for locked features */}
          <FeatureGate feature="image_understanding" featureLabel="Image Understanding" requiredPlan="PACKAGE_2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Image Understanding</p>
                <p className="text-xs text-gray-500">AI reads product images to answer customer questions</p>
              </div>
            </div>
          </FeatureGate>
          <FeatureGate feature="advanced_ai" featureLabel="Advanced AI" requiredPlan="PACKAGE_2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 border border-purple-100 mt-2">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Advanced AI</p>
                <p className="text-xs text-gray-500">Higher accuracy responses + 30 req/min rate limit</p>
              </div>
            </div>
          </FeatureGate>
        </div>
      </div>

      {/* Section 6: Billing Summary */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('subscription.billingTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-gray-600">{t('subscription.basePlan')}</span>
            <span className="font-semibold text-gray-900">৳{currentPlan.price.toLocaleString()} BDT</span>
          </div>
          {usage.conversations.status === 'exceeded' && (
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600">{t('subscription.extraUsageCharge')}</span>
              <span className="font-semibold text-gray-900">৳{extraUsage.estimatedCharge.toLocaleString()} BDT</span>
            </div>
          )}
          {selectedConversationPack && (
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600">{t('subscription.addedConversations', { count: selectedConversationPack })}</span>
              <span className="font-semibold text-gray-900">
                ৳{conversationPacks.find(p => p.amount === selectedConversationPack)?.price.toLocaleString()} BDT
              </span>
            </div>
          )}
          <div className="border-t border-gray-200 pt-3 mt-3">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-gray-900">{t('subscription.estimatedInvoice')}</span>
              <span className="text-2xl font-bold text-gray-900">৳{calculateTotalBill().toLocaleString()} BDT</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          {t('subscription.invoiceDisclaimer')}
        </p>
      </div>

      {/* Section 7: Invoice History */}
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('subscription.invoicesTitle')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.id')}</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.period')}</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.type')}</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.amount')}</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.status')}</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">{t('subscription.invoiceColumns.action')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-4 px-4 text-sm font-medium text-gray-900">{invoice.id}</td>
                  <td className="py-4 px-4 text-sm text-gray-600">{invoice.billingPeriod}</td>
                  <td className="py-4 px-4 text-sm text-gray-600">{invoice.type}</td>
                  <td className="py-4 px-4 text-sm font-semibold text-gray-900">৳{invoice.amount.toLocaleString()}</td>
                  <td className="py-4 px-4">
                    <Badge className={invoice.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                      {invoice.status === 'paid' ? t('subscription.paid') : t('subscription.pending')}
                    </Badge>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.open(`/api/subscription/invoices/${invoice.rawId}/pdf`, '_blank')}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="View / Print invoice"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => window.open(`/api/subscription/invoices/${invoice.rawId}/pdf`, '_blank')}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Download invoice (print to PDF)"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
