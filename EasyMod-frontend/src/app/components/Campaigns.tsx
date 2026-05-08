import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/api';
import type { Campaign, CreateCampaignRequest } from '@/api/types/campaign';

const DEFAULT_RECIPIENT_CAP = 500;

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleById, setScheduleById] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [form, setForm] = useState<CreateCampaignRequest>({
    name: '',
    message_template: '',
    segment_filter: {
      minOrders: 0,
      paymentMethod: '',
      requireConsent: true,
      recipientCap: DEFAULT_RECIPIENT_CAP,
    },
  });

  const [preflightErrors, preflightWarnings] = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const segment = form.segment_filter || {};

    if (!form.name.trim()) {
      errors.push('Campaign name is required.');
    }

    if (!form.message_template.trim()) {
      errors.push('Message template is required.');
    }

    if ((segment.recipientCap || 0) <= 0) {
      errors.push('Recipient cap must be greater than 0.');
    }

    if ((segment.recipientCap || 0) > DEFAULT_RECIPIENT_CAP) {
      warnings.push(`Recipient cap above ${DEFAULT_RECIPIENT_CAP} may be blocked by policy limit.`);
    }

    if (segment.requireConsent === false) {
      warnings.push('Consent requirement is disabled. This increases compliance risk.');
    }

    if (form.message_template.trim().length < 10) {
      warnings.push('Message template is very short and may perform poorly.');
    }

    return [errors, warnings];
  }, [form]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const rows = await apiClient.getCampaigns();
      setCampaigns(rows);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to load campaigns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCampaigns();
  }, []);

  // Auto-poll every 5 seconds while any campaign is in 'running' state
  useEffect(() => {
    const hasRunning = campaigns.some((c) => c.status === 'running');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const running = campaigns.filter((c) => c.status === 'running');
        for (const c of running) {
          try {
            const stats = await apiClient.getCampaignStats(c.id);
            setCampaigns((prev) =>
              prev.map((p) =>
                p.id === c.id
                  ? { ...p, status: stats.status, sent_count: stats.sent_count, failed_count: stats.failed_count, total_recipients: stats.total_recipients }
                  : p
              )
            );
          } catch { /* silent — next tick will retry */ }
        }
      }, 5000);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && !campaigns.some((c) => c.status === 'running')) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [campaigns]);

  const onCreateCampaign = async () => {
    if (preflightErrors.length > 0) {
      toast.error(preflightErrors[0]);
      return;
    }

    try {
      setSubmitting(true);
      const payload: CreateCampaignRequest = {
        ...form,
        segment_filter: {
          ...form.segment_filter,
          paymentMethod: form.segment_filter?.paymentMethod || undefined,
        },
      };

      const created = await apiClient.createCampaign(payload);
      setCampaigns((prev) => [created, ...prev]);
      setForm({
        name: '',
        message_template: '',
        segment_filter: {
          minOrders: 0,
          paymentMethod: '',
          requireConsent: true,
          recipientCap: DEFAULT_RECIPIENT_CAP,
        },
      });
      toast.success('Campaign created.');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to create campaign.');
    } finally {
      setSubmitting(false);
    }
  };

  const onRunCampaign = async (campaignId: string) => {
    try {
      setRunningId(campaignId);
      const updated = await apiClient.launchCampaign(campaignId);
      setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updated : c)));
      toast.success('Campaign run started.');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to run campaign.');
    } finally {
      setRunningId(null);
    }
  };

  const onScheduleCampaign = async (campaignId: string) => {
    const scheduledAt = scheduleById[campaignId];
    if (!scheduledAt) {
      toast.error('Pick a schedule time first.');
      return;
    }

    try {
      setSchedulingId(campaignId);
      const updated = await apiClient.scheduleCampaign(campaignId, scheduledAt);
      setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updated : c)));
      toast.success('Campaign scheduled.');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to schedule campaign.');
    } finally {
      setSchedulingId(null);
    }
  };

  const onRefreshStats = async (campaignId: string) => {
    try {
      const stats = await apiClient.getCampaignStats(campaignId);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? {
                ...c,
                status: stats.status,
                scheduled_at: stats.scheduled_at,
                total_recipients: stats.total_recipients,
                sent_count: stats.sent_count,
                failed_count: stats.failed_count,
                updated_at: stats.updated_at,
              }
            : c
        )
      );
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to refresh stats.');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Campaign Control Panel</h1>
        <p className="text-sm text-gray-600 mt-1">Create compliant campaigns with consent and recipient-cap safeguards.</p>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Create Campaign</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign name</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ramadan Win-Back"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment method filter (optional)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.segment_filter?.paymentMethod || ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  segment_filter: { ...prev.segment_filter, paymentMethod: e.target.value },
                }))
              }
              placeholder="COD"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum orders</label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.segment_filter?.minOrders || 0}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  segment_filter: { ...prev.segment_filter, minOrders: Number(e.target.value || 0) },
                }))
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient cap</label>
            <input
              type="number"
              min={1}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.segment_filter?.recipientCap || DEFAULT_RECIPIENT_CAP}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  segment_filter: { ...prev.segment_filter, recipientCap: Number(e.target.value || DEFAULT_RECIPIENT_CAP) },
                }))
              }
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message template</label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-24"
            value={form.message_template}
            onChange={(e) => setForm((prev) => ({ ...prev, message_template: e.target.value }))}
            placeholder="Hi! We miss you. Get 15% off on your next order this week."
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.segment_filter?.requireConsent !== false}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                segment_filter: { ...prev.segment_filter, requireConsent: e.target.checked },
              }))
            }
          />
          Require customer consent (recommended)
        </label>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Preflight Validation</h3>
          {preflightErrors.length === 0 && preflightWarnings.length === 0 && (
            <p className="text-sm text-green-700">No blocking issues detected.</p>
          )}
          {preflightErrors.map((err) => (
            <p key={err} className="text-sm text-red-700">- {err}</p>
          ))}
          {preflightWarnings.map((warn) => (
            <p key={warn} className="text-sm text-amber-700">- {warn}</p>
          ))}
        </div>

        <button
          onClick={onCreateCampaign}
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? 'Creating...' : 'Create campaign'}
        </button>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Campaigns</h2>
          <button onClick={loadCampaigns} className="text-sm text-blue-700 hover:underline">Refresh</button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading campaigns...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-gray-500">No campaigns yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 text-gray-600">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Recipients</th>
                  <th className="py-2 pr-3">Consent</th>
                  <th className="py-2 pr-3">Schedule</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-gray-100 align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-900">{campaign.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{campaign.message_template.slice(0, 80)}{campaign.message_template.length > 80 ? '...' : ''}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="capitalize">{campaign.status}</span>
                      {campaign.status === 'running' && campaign.total_recipients > 0 && (
                        <div className="mt-1">
                          <div className="w-24 bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-green-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${Math.min(100, Math.round(((campaign.sent_count ?? 0) / campaign.total_recipients) * 100))}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {campaign.sent_count ?? 0}/{campaign.total_recipients} sent
                            {(campaign.failed_count ?? 0) > 0 && <span className="text-red-500 ml-1">· {campaign.failed_count} failed</span>}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3">{campaign.total_recipients}</td>
                    <td className="py-3 pr-3">{campaign.segment_filter?.requireConsent === false ? 'No' : 'Yes'}</td>
                    <td className="py-3 pr-3">
                      <input
                        type="datetime-local"
                        className="border border-gray-300 rounded px-2 py-1"
                        value={scheduleById[campaign.id] || ''}
                        onChange={(e) => setScheduleById((prev) => ({ ...prev, [campaign.id]: e.target.value }))}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => onRunCampaign(campaign.id)}
                          disabled={runningId === campaign.id}
                          className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                        >
                          {runningId === campaign.id ? 'Running...' : 'Run'}
                        </button>
                        <button
                          onClick={() => onScheduleCampaign(campaign.id)}
                          disabled={schedulingId === campaign.id}
                          className="px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-60"
                        >
                          {schedulingId === campaign.id ? 'Scheduling...' : 'Schedule'}
                        </button>
                        <button
                          onClick={() => onRefreshStats(campaign.id)}
                          className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-800"
                        >
                          Stats
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
