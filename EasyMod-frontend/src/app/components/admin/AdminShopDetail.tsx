import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi } from '@/api/domains/admin';
import { useIsPlatformAdmin } from '@/shared/lib/auth/useIsPlatformAdmin';

const TABS = ['Overview', 'Channels', 'Billing', 'AI & Inbox', 'Orders & Courier'] as const;
type Tab = typeof TABS[number];

export default function AdminShopDetail() {
  const { shopId = '' } = useParams();
  const { role } = useIsPlatformAdmin();
  const canMutate = role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<Tab>('Overview');
  const [overview, setOverview] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => {
    adminApi.getShop(shopId).then(setOverview).catch(() => {});
    adminApi.getShopChannels(shopId).then(setChannels).catch(() => {});
    adminApi.getShopBilling(shopId).then(setBilling).catch(() => {});
  };
  useEffect(reload, [shopId]);

  const act = async (fn: () => Promise<any>, label: string) => {
    try { await fn(); setMsg(`${label} ✓`); reload(); }
    catch (e: any) { setMsg(`${label} failed: ${e?.message || e}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">{overview?.shop?.shopName || 'Shop'}</h1>
      {msg && <div className="rounded bg-gray-100 px-3 py-2 text-sm">{msg}</div>}

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && overview && (
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div><dt className="text-gray-500">Owner</dt><dd>{overview.owner?.email || '—'}</dd></div>
          <div><dt className="text-gray-500">Plan</dt><dd>{overview.subscription?.planName || '—'}</dd></div>
          <div><dt className="text-gray-500">Status</dt><dd>{overview.subscription?.status || '—'}</dd></div>
          <div><dt className="text-gray-500">Trial ends</dt><dd>{overview.subscription?.trialEndsAt ? new Date(overview.subscription.trialEndsAt).toLocaleDateString() : '—'}</dd></div>
          <div><dt className="text-gray-500">Conversations</dt><dd>{overview.usage?.conversationsUsed ?? '—'}/{overview.usage?.conversationsLimit ?? '—'}</dd></div>
          <div><dt className="text-gray-500">Onboarding</dt><dd>{overview.onboarding?.completed ? 'Complete' : 'Incomplete'}</dd></div>
        </dl>
      )}

      {tab === 'Channels' && (
        <div className="space-y-3">
          <button
            disabled={!canMutate}
            title={canMutate ? 'Stop all AI automation for this shop' : 'SUPER_ADMIN required'}
            onClick={() => {
              if (!canMutate) return;
              if (window.confirm('EMERGENCY: stop ALL AI automation for this shop? Inbound messages still arrive; only automated replies stop.')) {
                act(() => adminApi.emergencyAiOff(shopId), 'Emergency AI off');
              }
            }}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Emergency: stop AI
          </button>
          {!canMutate && <span className="text-xs text-gray-500">SUPER_ADMIN required for channel actions.</span>}
          <table className="min-w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Platform</th>
                <th className="px-3 py-2">Token</th>
                <th className="px-3 py-2">Webhook</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{c.displayName}</td>
                  <td className="px-3 py-2">{c.platform}</td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2">{c.webhookLastVerifiedAt ? 'verified' : '—'}</td>
                  <td className="px-3 py-2 text-red-600">{c.lastError || '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      disabled={!canMutate}
                      title={canMutate ? 'Mark this channel as needing reconnect' : 'SUPER_ADMIN required'}
                      onClick={() => {
                        if (canMutate) act(() => adminApi.markReconnect(shopId, c.id), 'Mark reconnect');
                      }}
                      className="text-blue-600 disabled:cursor-not-allowed disabled:text-gray-400"
                    >
                      Mark reconnect
                    </button>
                  </td>
                </tr>
              ))}
              {channels.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No channels</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Billing' && billing && (
        <div className="space-y-4 text-sm">
          {/* Summary grid */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div><dt className="text-gray-500">Plan</dt><dd><b>{billing.planName}</b> ({billing.billingCycle || '—'})</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className={billing.status === 'suspended' || billing.status === 'trial_expired' ? 'text-red-700 font-medium' : ''}>{billing.status}</dd></div>
            <div><dt className="text-gray-500">Conversations</dt><dd>{billing.conversationsUsed ?? '—'}/{billing.conversationsLimit ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Top-up balance</dt><dd>{billing.topupBalance ?? 0}</dd></div>
            <div><dt className="text-gray-500">Next billing</dt><dd>{billing.nextBillingDate ? new Date(billing.nextBillingDate).toLocaleDateString() : '—'}</dd></div>
            <div><dt className="text-gray-500">Trial ends</dt><dd>{billing.trialEndsAt ? new Date(billing.trialEndsAt).toLocaleDateString() : '—'}</dd></div>
            <div><dt className="text-gray-500">Accrued overage</dt><dd>{billing.extraConversations ?? 0} conv · ৳{(billing.extraCharge ?? 0).toLocaleString()}</dd></div>
            <div><dt className="text-gray-500">Outstanding</dt><dd className={billing.outstandingAmount > 0 ? 'text-amber-700 font-medium' : ''}>৳{(billing.outstandingAmount ?? 0).toLocaleString()}</dd></div>
          </dl>

          {!canMutate && <p className="text-xs text-gray-500">SUPER_ADMIN required for billing actions.</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={!canMutate} onClick={() => act(() => adminApi.extendTrial(shopId, 7), 'Extend trial 7d')} className="rounded border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-45">Extend trial 7d</button>
            <button disabled={!canMutate} onClick={() => act(() => adminApi.addCredits(shopId, 50, 'admin_grant'), 'Add 50 credits')} className="rounded border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-45">Add 50 credits</button>
            {billing.status === 'suspended' || billing.status === 'trial_expired' || billing.status === 'past_due'
              ? <button disabled={!canMutate} onClick={() => act(() => adminApi.setStatus(shopId, 'active'), 'Reactivate')} className="rounded border px-3 py-1.5 text-green-700 disabled:cursor-not-allowed disabled:opacity-45">Reactivate (AI on)</button>
              : <button disabled={!canMutate} onClick={() => act(() => adminApi.setStatus(shopId, 'suspended'), 'Suspend')} className="rounded border px-3 py-1.5 text-red-700 disabled:cursor-not-allowed disabled:opacity-45">Suspend (AI off)</button>}
          </div>

          {/* Invoices */}
          <div>
            <h3 className="mb-1 font-medium text-gray-700">Invoices</h3>
            {Array.isArray(billing.invoices) && billing.invoices.length > 0 ? (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500">
                  <th className="py-1">Invoice</th><th>Type</th><th>Amount</th><th>Status</th><th>Due</th><th>Paid</th>
                </tr></thead>
                <tbody>
                  {billing.invoices.map((inv: any) => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-1 font-mono">{inv.invoiceNumber}</td>
                      <td>{inv.type}</td>
                      <td>৳{(inv.amount ?? 0).toLocaleString()}</td>
                      <td className={inv.status === 'paid' ? 'text-green-700' : inv.status === 'overdue' ? 'text-red-700' : 'text-amber-700'}>{inv.status}</td>
                      <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
                      <td>{inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-xs text-gray-400">No invoices yet.</p>}
          </div>
        </div>
      )}

      {(tab === 'AI & Inbox' || tab === 'Orders & Courier') && (
        <div className="rounded border border-dashed p-6 text-center text-gray-400">Phase 2</div>
      )}
    </div>
  );
}
