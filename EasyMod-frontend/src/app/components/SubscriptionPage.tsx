import { useState, useEffect } from 'react';
import { apiClient } from '@/api';
import { toast } from 'sonner';
import {
  CreditCard, TrendingUp, AlertTriangle, CheckCircle, Clock,
  Download, ArrowUpRight, Zap, RefreshCw, MessageSquare
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionData {
  plan_code: string;
  plan_name: string;
  plan_price: number;
  billing_cycle: string;
  conversations_limit: number;
  conversations_used: number;
  topup_balance: number;
  threshold_conversations: number;
  threshold_debt: number;
  status: string;
  current_period_end: string;
}

interface TopupPack {
  code: string;
  conversations: number;
  priceBdt: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  created_at: string;
  invoice_pdf_url?: string;
  pack_code?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatBDT = (amount: number) => `৳${amount.toLocaleString('en-BD')}`;

const getUsageColor = (pct: number) => {
  if (pct >= 100) return { bar: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' };
  if (pct >= 90)  return { bar: 'bg-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' };
  if (pct >= 75)  return { bar: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
};

// ── Conversation Meter ────────────────────────────────────────────────────────

function ConversationMeter({ sub }: { sub: SubscriptionData }) {
  const isUnlimited = sub.conversations_limit < 0;
  const effective = sub.conversations_limit + sub.topup_balance + sub.threshold_conversations;
  const pct = isUnlimited ? 0 : Math.min(Math.round((sub.conversations_used / effective) * 100), 100);
  const colors = getUsageColor(pct);

  if (isUnlimited) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-emerald-600" />
        <span className="text-sm font-medium text-emerald-700">Unlimited conversations (Partner plan)</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 ${colors.bg} ${colors.border}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MessageSquare className={`w-4 h-4 ${colors.text}`} />
          <span className="text-sm font-semibold text-gray-800">Moderator Conversations</span>
        </div>
        <span className={`text-sm font-bold ${colors.text}`}>{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-3 rounded-full bg-gray-200 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>{sub.conversations_used.toLocaleString()} used</span>
        <span>{effective.toLocaleString()} total</span>
      </div>

      {/* Breakdown */}
      <div className="mt-3 space-y-1 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Plan limit</span>
          <span className="font-medium">{sub.conversations_limit.toLocaleString()}</span>
        </div>
        {sub.topup_balance > 0 && (
          <div className="flex justify-between text-blue-600">
            <span>Top-up balance</span>
            <span className="font-medium">+{sub.topup_balance.toLocaleString()}</span>
          </div>
        )}
        {sub.threshold_conversations > 0 && (
          <div className="flex justify-between text-orange-600">
            <span>Emergency buffer (next cycle deduction: {sub.threshold_debt})</span>
            <span className="font-medium">+{sub.threshold_conversations.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Alert banners */}
      {pct >= 100 && (
        <div className="mt-3 rounded-lg bg-red-100 border border-red-300 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 font-medium">
            Limit reached! Emergency conversations active. Top up or upgrade to avoid disruption.
          </p>
        </div>
      )}
      {pct >= 90 && pct < 100 && (
        <div className="mt-3 rounded-lg bg-orange-100 border border-orange-300 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-700 font-medium">
            90% of conversations used! Top up now to ensure uninterrupted service.
          </p>
        </div>
      )}
      {pct >= 75 && pct < 90 && (
        <div className="mt-3 rounded-lg bg-amber-100 border border-amber-300 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 font-medium">
            75% of conversations used. Consider topping up soon.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Top-Up Panel ──────────────────────────────────────────────────────────────

function TopupPanel({ onComplete }: { onComplete: () => void }) {
  const [packs, setPacks] = useState<TopupPack[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiClient.get('/subscription/topup/packs')
      .then(res => setPacks(res.data.data || []))
      .catch(() => setPacks([]));
  }, []);

  const handlePurchase = async () => {
    if (!selected) return toast.error('Please select a pack');
    setLoading(true);
    try {
      const res = await apiClient.post('/subscription/topup/initiate', {
        pack_code: selected,
        callback_url: `${window.location.origin}/app/subscription/topup-callback`
      });
      const { bkash_url } = res.data.data;
      if (bkash_url) {
        window.location.href = bkash_url;
      } else {
        toast.error('Failed to start bKash payment');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to initiate top-up');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-800">Buy Conversation Pack</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {packs.map(pack => (
          <button
            key={pack.code}
            onClick={() => setSelected(pack.code)}
            className={`p-3 rounded-xl border-2 text-left transition-all ${
              selected === pack.code
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-blue-300 bg-gray-50'
            }`}
          >
            <div className="text-lg font-bold text-gray-900">+{pack.conversations.toLocaleString()}</div>
            <div className="text-xs text-gray-500">conversations</div>
            <div className="mt-1 text-sm font-semibold text-pink-600">{formatBDT(pack.priceBdt)}</div>
          </button>
        ))}
      </div>

      <button
        onClick={handlePurchase}
        disabled={!selected || loading}
        className="w-full py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
        Pay with bKash
      </button>
    </div>
  );
}

// ── Plan Cards ────────────────────────────────────────────────────────────────

const PLANS = [
  {
    code: 'PACKAGE_1',
    name: 'Package 1',
    price: 750,
    conversations: 500,
    color: 'border-emerald-300 bg-emerald-50',
    badge: 'text-emerald-700 bg-emerald-100'
  },
  {
    code: 'PACKAGE_2',
    name: 'Package 2',
    price: 1950,
    conversations: 1500,
    color: 'border-blue-300 bg-blue-50',
    badge: 'text-blue-700 bg-blue-100',
    recommended: true
  },
  {
    code: 'PARTNER',
    name: 'Partner',
    price: 0,
    conversations: -1,
    color: 'border-purple-300 bg-purple-50',
    badge: 'text-purple-700 bg-purple-100'
  }
];

function PlanCards({ currentCode, onUpgrade }: { currentCode: string; onUpgrade: (code: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {PLANS.map(plan => {
        const isActive = plan.code === currentCode;
        return (
          <div
            key={plan.code}
            className={`rounded-xl border-2 p-4 relative ${plan.color} ${
              plan.recommended ? 'ring-2 ring-blue-400' : ''
            }`}
          >
            {plan.recommended && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500 text-white">
                Recommended
              </span>
            )}
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${plan.badge}`}>{plan.name}</span>
              {isActive && <CheckCircle className="w-4 h-4 text-emerald-600" />}
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {plan.price === 0 ? 'Free' : formatBDT(plan.price)}
              {plan.price > 0 && <span className="text-sm font-normal text-gray-500">/mo</span>}
            </div>
            <div className="text-xs text-gray-600 mt-1 mb-3">
              {plan.conversations < 0 ? 'Unlimited conversations' : `${plan.conversations.toLocaleString()} conversations/mo`}
            </div>
            {plan.code === 'PARTNER' && (
              <div className="text-xs text-gray-500 mb-3">
                0-500 orders: ৳15/order<br />
                501-1000: ৳12/order<br />
                1001+: ৳10/order
              </div>
            )}
            <button
              disabled={isActive}
              onClick={() => onUpgrade(plan.code)}
              className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-gray-200 text-gray-500 cursor-default'
                  : 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-800'
              }`}
            >
              {isActive ? 'Current Plan' : 'Upgrade'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Billing History ───────────────────────────────────────────────────────────

function BillingHistory() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get('/subscription/invoices').catch(() => ({ data: { data: [] } })),
      apiClient.get('/subscription/topup/history').catch(() => ({ data: { data: [] } }))
    ]).then(([inv, topup]) => {
      const all: Invoice[] = [
        ...(inv.data.data || []),
        ...(topup.data.data || []).map((t: any) => ({
          id: t.id,
          invoice_number: t.invoice_number || t.id,
          amount: t.amount_bdt,
          status: t.status,
          created_at: t.created_at,
          invoice_pdf_url: t.invoice_pdf_url,
          pack_code: t.pack_code
        }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setInvoices(all);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-gray-400 py-4 text-center">Loading billing history…</div>;
  if (!invoices.length) return <div className="text-sm text-gray-400 py-4 text-center">No invoices yet.</div>;

  return (
    <div className="divide-y divide-gray-100">
      {invoices.map(inv => (
        <div key={inv.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-gray-800">{inv.invoice_number}</p>
            <p className="text-xs text-gray-400">
              {new Date(inv.created_at).toLocaleDateString('en-GB')}
              {inv.pack_code && ` · ${inv.pack_code}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">{formatBDT(Number(inv.amount))}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              inv.status === 'completed' || inv.status === 'paid'
                ? 'bg-emerald-100 text-emerald-700'
                : inv.status === 'pending'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {inv.status}
            </span>
            {inv.invoice_pdf_url && (
              <a
                href={inv.invoice_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SubscriptionPage() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  const fetchSub = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/subscription');
      setSub(res.data.data?.subscription ?? res.data.subscription);
    } catch {
      toast.error('Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSub(); }, []);

  const handleUpgrade = async (planCode: string) => {
    setUpgrading(true);
    try {
      await apiClient.put('/subscription/plan', {
        plan_code: planCode,
        billing_cycle: 'monthly'
      });
      toast.success('Plan updated successfully');
      fetchSub();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update plan');
    } finally {
      setUpgrading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!sub) return null;

  const renewDate = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your plan, top-ups, and billing history.</p>
      </div>

      {/* Current Plan Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Current Plan</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{sub.plan_name}</h2>
            <p className="text-sm text-gray-500">
              {sub.plan_price > 0
                ? `${formatBDT(sub.plan_price)} / ${sub.billing_cycle}`
                : 'Pay per delivered order'}
              {' · '}
              Renews {renewDate}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
            sub.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {sub.status}
          </span>
        </div>

        <ConversationMeter sub={sub} />
      </div>

      {/* Top-Up */}
      <TopupPanel onComplete={fetchSub} />

      {/* Upgrade Plans */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Change Plan</h3>
        </div>
        <PlanCards currentCode={sub.plan_code} onUpgrade={handleUpgrade} />
      </div>

      {/* Billing History */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">Billing History</h3>
        </div>
        <BillingHistory />
      </div>

    </div>
  );
}
