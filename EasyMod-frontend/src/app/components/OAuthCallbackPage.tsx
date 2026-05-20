import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { handleMetaOAuthCallback } from '@/api/domains/meta-channels';

/**
 * Popup landing page for Meta OAuth callback.
 * Facebook redirects here with ?code=&state= after user authorizes.
 *
 * Happy path  (popup): post OAUTH_SUCCESS to opener → opener handles
 *   the handshake → this window closes.
 *
 * Fallback (opener cleared by browser security or direct tab navigation):
 *   complete the OAuth exchange here, then navigate to /app/channels.
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // ── Error case ────────────────────────────────────────────────────────────
    if (error) {
      if (window.opener) {
        try {
          window.opener.postMessage({ type: 'OAUTH_ERROR', error }, window.location.origin);
          window.close();
          return;
        } catch { /* opener from different origin — fall through */ }
      }
      sessionStorage.removeItem('easymod_oauth_channel_type');
      sessionStorage.removeItem('easymod_oauth_nonce');
      window.location.href = '/app/channels';
      return;
    }

    if (!code || !state) return;

    // Reconnect flow (Phase 2): the opener stashes the channelId it wants to
    // refresh under `easymod_oauth_channel_id` before opening the popup. We
    // forward it back in the OAUTH_SUCCESS payload so the opener knows which
    // channel record to update. Absent for fresh connections.
    const reconnectChannelId = sessionStorage.getItem('easymod_oauth_channel_id') || undefined;

    // ── Happy path: popup with live opener ───────────────────────────────────
    if (window.opener) {
      try {
        window.opener.postMessage(
          { type: 'OAUTH_SUCCESS', code, state, channelId: reconnectChannelId },
          window.location.origin,
        );
        window.close();
        return;
      } catch { /* opener from different origin — fall through to self-complete */ }
    }

    // ── Fallback: opener was cleared (cross-origin redirect security) ────────
    // Complete the OAuth exchange in this tab directly.
    sessionStorage.removeItem('easymod_oauth_channel_type');
    sessionStorage.removeItem('easymod_oauth_nonce');
    sessionStorage.removeItem('easymod_oauth_channel_id');

    handleMetaOAuthCallback(code, state)
      .catch((err: unknown) => {
        // Surface the failure on the channels page instead of silently redirecting.
        // The channels page reads and clears this key on mount.
        const message =
          (err as any)?.response?.data?.error?.message ||
          (err as any)?.message ||
          'Failed to connect your account. Please try again.';
        sessionStorage.setItem('oauth_error', message);
      })
      .finally(() => {
        window.location.href = '/app/channels';
      });
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
