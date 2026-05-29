import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Same-origin signalling between the popup and the opener tab.
// Facebook's COOP severs `window.opener` when the popup navigates to
// facebook.com, so a BroadcastChannel that both windows subscribe to
// is the only reliable channel back to the originating tab.
const OAUTH_CHANNEL_NAME = 'easymod_oauth';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    const broadcast = (payload: Record<string, unknown>) => {
      try {
        const bc = new BroadcastChannel(OAUTH_CHANNEL_NAME);
        bc.postMessage(payload);
        bc.close();
      } catch { /* BroadcastChannel unsupported — opener path handles it */ }
    };

    const closeOrRedirect = () => {
      window.close();
      // window.close() is a no-op when the browser blocks it; redirect ~120ms
      // later if we're still here so the user lands on the dashboard instead of
      // being stranded on the spinner.
      setTimeout(() => {
        if (!window.closed) {
          window.location.href = '/app/manage-shop/chat-settings';
        }
      }, 120);
    };

    if (error) {
      broadcast({ type: 'OAUTH_ERROR', error });
      if (window.opener) {
        try {
          window.opener.postMessage({ type: 'OAUTH_ERROR', error }, window.location.origin);
        } catch { /* opener from different origin — broadcast already sent */ }
      }
      sessionStorage.removeItem('easymod_oauth_channel_type');
      sessionStorage.removeItem('easymod_oauth_nonce');
      closeOrRedirect();
      return;
    }

    if (!code || !state) return;

    const reconnectChannelId = sessionStorage.getItem('easymod_oauth_channel_id') || undefined;
    const payload = { type: 'OAUTH_SUCCESS', code, state, channelId: reconnectChannelId };

    broadcast(payload);
    if (window.opener) {
      try {
        window.opener.postMessage(payload, window.location.origin);
      } catch { /* opener cross-origin — broadcast already delivered to the main tab */ }
    }
    closeOrRedirect();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
        </div>
        <p className="text-gray-600 text-sm">সংযুক্ত হচ্ছে...</p>
        <p className="text-gray-400 text-xs mt-1">Connecting to your account</p>
      </div>
    </div>
  );
}
