import { useState, useEffect } from 'react';
import { AlertTriangle, X, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api';

interface ConvLimitState {
  pct: number;
  used: number;
  limit: number;
  topup_balance: number;
  threshold_active: boolean;
}

const SESSION_DISMISSED_KEY = 'conv_alert_dismissed_pct';

export default function ConversationAlertBanner() {
  const [state, setState] = useState<ConvLimitState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get('/subscription')
      .then(res => {
        const sub = res.data.subscription || res.data.data?.subscription || res.data;
        if (!sub || sub.conversations_limit < 0) return; // unlimited plan

        const effective = sub.conversations_limit + (sub.topup_balance || 0) + (sub.threshold_conversations || 0);
        if (effective <= 0) return;

        const pct = Math.round((sub.conversations_used / effective) * 100);
        if (pct < 75) return;

        // Check if user already dismissed this pct tier this session
        const dismissedPct = Number(sessionStorage.getItem(SESSION_DISMISSED_KEY) || 0);
        if (dismissedPct >= pct) {
          setDismissed(true);
          return;
        }

        setState({
          pct,
          used: sub.conversations_used,
          limit: sub.conversations_limit,
          topup_balance: sub.topup_balance || 0,
          threshold_active: sub.threshold_conversations > 0
        });
      })
      .catch(() => {});
  }, []);

  const handleDismiss = () => {
    if (state) {
      sessionStorage.setItem(SESSION_DISMISSED_KEY, String(state.pct));
    }
    setDismissed(true);
  };

  if (!state || dismissed) return null;

  const { pct, threshold_active } = state;

  const config = pct >= 100
    ? { bg: 'bg-red-600', border: 'border-red-700', icon: 'text-red-100', text: 'text-white', label: threshold_active ? '⚡ Emergency buffer active — top up or upgrade now!' : '🚫 Conversation limit reached!' }
    : pct >= 90
    ? { bg: 'bg-orange-500', border: 'border-orange-600', icon: 'text-orange-100', text: 'text-white', label: `⚠️ ${pct}% of conversation limit used — almost full!` }
    : { bg: 'bg-amber-400', border: 'border-amber-500', icon: 'text-amber-900', text: 'text-amber-900', label: `⚠️ ${pct}% of conversation limit used` };

  return (
    <div className={`w-full ${config.bg} ${config.border} border-b px-4 py-2.5 flex items-center justify-between gap-3`}>
      <div className={`flex items-center gap-2 ${config.text}`}>
        <AlertTriangle className={`w-4 h-4 shrink-0 ${config.icon}`} />
        <span className="text-sm font-semibold">{config.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/app/subscription')}
          className={`flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 ${config.text} transition-colors`}
        >
          Top Up <ArrowUpRight className="w-3 h-3" />
        </button>
        <button
          onClick={handleDismiss}
          className={`p-1 rounded-full hover:bg-white hover:bg-opacity-20 transition-colors ${config.text}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
