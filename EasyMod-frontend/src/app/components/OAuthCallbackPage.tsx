import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';

// Same-origin signalling between the popup and the opener tab.
// Facebook's COOP severs `window.opener` when the popup navigates to
// facebook.com, so a BroadcastChannel that both windows subscribe to
// is the only reliable channel back to the originating tab.
const OAUTH_CHANNEL_NAME = 'easymod_oauth';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setErrorMessage(t('oauthCallback.providerError', { error }));
      closeOrRedirect();
      return;
    }

    if (!code || !state) {
      const message = t('oauthCallback.missingParams');
      setErrorMessage(message);
      broadcast({ type: 'OAUTH_ERROR', error: 'missing_code_or_state' });
      if (window.opener) {
        try {
          window.opener.postMessage({ type: 'OAUTH_ERROR', error: 'missing_code_or_state' }, window.location.origin);
        } catch { /* opener from different origin — broadcast already sent */ }
      }
      return;
    }

    const reconnectChannelId = sessionStorage.getItem('easymod_oauth_channel_id') || undefined;
    const payload = { type: 'OAUTH_SUCCESS', code, state, channelId: reconnectChannelId };

    broadcast(payload);
    if (window.opener) {
      try {
        window.opener.postMessage(payload, window.location.origin);
      } catch { /* opener cross-origin — broadcast already delivered to the main tab */ }
    }
    closeOrRedirect();
  }, [searchParams, t]);

  if (errorMessage) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white px-4">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">{t('oauthCallback.errorTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600">{errorMessage}</p>
          <Link
            to="/app/manage-shop/chat-settings"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t('oauthCallback.retry')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-7 h-7 text-blue-600 animate-spin" />
        </div>
        <p className="text-gray-600 text-sm">{t('oauthCallback.connecting')}</p>
        <p className="text-gray-400 text-xs mt-1">{t('oauthCallback.connectingToAccount')}</p>
      </div>
    </div>
  );
}
