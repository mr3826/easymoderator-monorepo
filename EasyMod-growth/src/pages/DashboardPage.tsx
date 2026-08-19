import { ClipboardList, LockKeyhole, UserRoundCheck } from 'lucide-react';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

export function DashboardPage() {
  const { session } = useGrowthAuth();

  return (
    <main className="dashboard-grid">
      <section className="status-panel primary-panel" aria-labelledby="dashboard-title">
        <div>
          <p className="eyebrow">Foundation ready</p>
          <h2 id="dashboard-title">No modules enabled yet</h2>
          <p>
            Prospects, follow-ups, demos, trials, and command center workflows are intentionally deferred to later prompts.
          </p>
        </div>
        <ClipboardList aria-hidden="true" />
      </section>

      <section className="status-panel">
        <UserRoundCheck aria-hidden="true" />
        <div>
          <p className="eyebrow">Logged-in internal user</p>
          <h2>{session?.displayName}</h2>
          <p>{session?.role}</p>
        </div>
      </section>

      <section className="status-panel">
        <LockKeyhole aria-hidden="true" />
        <div>
          <p className="eyebrow">Access boundary</p>
          <h2>Backend enforced</h2>
          <p>{session?.permissions.length ?? 0} Growth OS permissions loaded from explicit internal role assignment.</p>
        </div>
      </section>
    </main>
  );
}
