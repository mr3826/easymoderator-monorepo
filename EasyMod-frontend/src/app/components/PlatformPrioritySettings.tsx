import { useState, useEffect } from 'react';
import { apiClient } from '@/api';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Info, Save, RefreshCw } from 'lucide-react';

/**
 * PlatformPrioritySettings
 *
 * Lets the shop owner reorder payment and delivery platforms.
 * The AI defaults to index-0 when presenting options to customers.
 * Mount this inside ManageShop or a dedicated Settings tab.
 */

interface PriorityData {
  payment: string[];
  delivery: string[];
}

function PriorityList({
  label,
  items,
  onChange,
  tooltip
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  tooltip: string;
}) {
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  if (items.length === 0) {
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{label}</h3>
        <p className="text-xs text-gray-400 italic">
          No platforms connected yet. Add them in the payment/delivery settings.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
        <div className="relative group">
          <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
          <div className="absolute z-10 left-5 -top-1 hidden group-hover:block w-56 bg-gray-900 text-white text-xs rounded-lg p-2.5 shadow-lg">
            {tooltip}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((platform, idx) => (
          <div
            key={platform}
            className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
              idx === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              {idx === 0 && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                  Default
                </span>
              )}
              <span className="text-sm font-medium text-gray-800 capitalize">{platform}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                title="Move up (higher priority)"
              >
                <ArrowUp className="w-3.5 h-3.5 text-gray-500" />
              </button>
              <button
                onClick={() => move(idx, 1)}
                disabled={idx === items.length - 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                title="Move down (lower priority)"
              >
                <ArrowDown className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlatformPrioritySettings() {
  const [priority, setPriority] = useState<PriorityData>({ payment: [], delivery: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/shop/platform-priority')
      .then(res => setPriority(res.data.data || { payment: [], delivery: [] }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put('/shop/platform-priority', priority);
      toast.success('Platform priority saved');
    } catch {
      toast.error('Failed to save priority');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Platform Priority</h2>
        <p className="text-xs text-gray-500">
          The AI defaults to the top platform when responding to customers.
          Drag or use the arrows to reorder.
        </p>
      </div>

      <PriorityList
        label="Payment Platforms"
        items={priority.payment}
        onChange={payment => setPriority(prev => ({ ...prev, payment }))}
        tooltip="The AI offers the top payment option first when a customer wants to pay. Set bKash first for most BD shops."
      />

      <PriorityList
        label="Delivery Platforms"
        items={priority.delivery}
        onChange={delivery => setPriority(prev => ({ ...prev, delivery }))}
        tooltip="The AI books delivery with the top platform first. Switch to your preferred courier here."
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
      >
        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Priority
      </button>
    </div>
  );
}
