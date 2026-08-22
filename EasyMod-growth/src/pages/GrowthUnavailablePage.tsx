import { RotateCw } from 'lucide-react';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

export function GrowthUnavailablePage() {
  const { error, refreshSession } = useGrowthAuth();

  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="growth-unavailable-title">
        <p className="eyebrow">Temporary service state</p>
        <h1 id="growth-unavailable-title">Growth OS is temporarily unavailable</h1>
        <p className="state-copy">Authorization or a required runtime dependency did not respond. No analytics success state was assumed.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" onClick={() => void refreshSession()}>
          <RotateCw aria-hidden="true" />
          <span>Retry</span>
        </button>
      </section>
    </main>
  );
}
