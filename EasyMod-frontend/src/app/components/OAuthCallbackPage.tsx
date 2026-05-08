import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

/**
 * Popup landing page for Meta OAuth callback.
 * Facebook redirects here with ?code=&state= after user authorizes.
 * Sends result to the parent window via postMessage, then closes itself.
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (!window.opener) {
      // Opened directly, not via popup — redirect to channels settings
      window.location.href = '/settings/channels';
      return;
    }

    try {
      if (error) {
        window.opener.postMessage({ type: 'OAUTH_ERROR', error }, window.location.origin);
        window.close();
        return;
      }

      if (code && state) {
        window.opener.postMessage({ type: 'OAUTH_SUCCESS', code, state }, window.location.origin);
        window.close();
      }
    } catch {
      // opener from a different origin — redirect to app
      window.location.href = '/settings/channels';
    }
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
