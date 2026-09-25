import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, growthApi } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState, MessageState } from '@/components/states';

interface SetupData {
  secret: string;
  qrUrl: string;
}

export function EnrollMfaPage() {
  const auth = useGrowthAuth();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    growthApi.setupTwoFactor()
      .then((data) => { if (!cancelled) setSetup(data); })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate('/login', { replace: true });
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'Unable to start MFA enrollment.');
      });
    return () => { cancelled = true; };
  }, [loadAttempt, navigate]);

  const enable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await growthApi.enableTwoFactor(token.trim());
      setDone(true);
      growthApi.logout().catch(() => undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Verification failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (auth.status === 'loading' && !setup && !loadError) return <LoadingState />;
  if (loadError && !setup) {
    return (
      <MessageState eyebrow="MFA enrollment" title="MFA enrollment is unavailable">
        <p>{loadError}</p>
        <button className="primary-button" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Retry enrollment setup
        </button>
      </MessageState>
    );
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="mfa-title">
        <p className="eyebrow">Internal workspace</p>
        <h1 id="mfa-title">Add multi-factor authentication</h1>
        <p>
          Super Admin access requires a time-based one-time password (TOTP).
          Add the secret below to your authenticator app, then confirm with a
          generated code.
        </p>

        {done ? (
          <>
            <p className="mfa-done" role="status">
              MFA enabled. Sign in again to complete verification.
            </p>
            <button className="secondary-button" type="button" onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </button>
          </>
        ) : setup ? (
          <form onSubmit={enable} className="login-form">
            <label htmlFor="mfa-secret">
              Setup key
            </label>
            <code id="mfa-secret" className="mfa-secret" data-testid="mfa-secret">{setup.secret}</code>
            <p className="mfa-url-hint">Or open this URL in your authenticator app:</p>
            <code className="mfa-secret mfa-otpauth" data-testid="mfa-otpauth-url">{setup.qrUrl}</code>

            <label htmlFor="mfa-token">
              Current 6-digit code
            </label>
            <input
              id="mfa-token"
              name="mfa-token"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={token}
              onChange={(event) => setToken(event.target.value.replace(/[^0-9]/g, ''))}
            />
            {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
            <button type="submit" className="primary-button" disabled={busy || token.length !== 6}>
              {busy ? 'Verifying…' : 'Verify and enable'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/login', { replace: true })}
            >
              Back to sign in
            </button>
          </form>
        ) : <LoadingState />}
      </section>
    </main>
  );
}
