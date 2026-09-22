import { useEffect, useState } from 'react';
import { Activity, BarChart3, ListChecks, RefreshCw, ScrollText, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { workspaceApi, type HomeResponse } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState, MessageState } from '@/components/states';

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The operational overview could not be loaded. Please try again.';
}

function AttentionCard({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="attention-card">
      <span className={warn ? 'metric warn' : 'metric'}>{value.toLocaleString()}</span>
      <strong>{label}</strong>
    </div>
  );
}

export function HomePage() {
  const { reportApiError, session } = useGrowthAuth();
  const canManageFollowups = session?.permissions.includes('growth_os.followups.manage') ?? false;
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.home()
      .then((nextHome) => {
        if (active) setHome(nextHome);
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setError(errorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadToken, reportApiError]);

  if (loading) return <LoadingState />;

  if (error || !home) {
    return (
      <MessageState eyebrow="Operational overview" title="Today is unavailable">
        <p>{error || 'No overview data was returned.'}</p>
        <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
          Try again
        </button>
      </MessageState>
    );
  }

  const { myWork, growthAttention, merchantAttention, platformAttention, recentPrivilegedActions } = home;

  return (
    <main className="page-content" aria-labelledby="home-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Operational overview</p>
          <h1 id="home-title">Today</h1>
          <p className="page-lede">What is due, what needs attention, and what changed in your scope.</p>
        </div>
        <div className="button-row">
          <button className="icon-button" type="button" aria-label="Refresh overview" title="Refresh overview" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="table-subtext">Generated {formatDate(home.generatedAt, true)}</p>

      <section className="content-card" aria-labelledby="my-work-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">You are scheduled to do</p>
            <h3 id="my-work-title">My Work</h3>
          </div>
          <ListChecks aria-hidden="true" />
        </div>
        <div className="work-list">
          <div className={myWork.followupsOverdueMine > 0 ? 'work-item overdue' : 'work-item'}>
            <div>
              <strong>{myWork.followupsOverdueMine.toLocaleString()}</strong>
              <span className="table-subtext"> overdue follow-ups assigned to you</span>
            </div>
            {canManageFollowups ? <Link className="secondary-button" to="/my-work">Review in My Work</Link> : null}
          </div>
          <div className="work-item">
            <div>
              <strong>{myWork.followupsOpenMine.toLocaleString()}</strong>
              <span className="table-subtext"> open follow-ups assigned to you</span>
            </div>
          </div>
          <div className="work-item">
            <div>
              <strong>{myWork.prospectsAssignedToMe.toLocaleString()}</strong>
              <span className="table-subtext"> prospects assigned to you</span>
            </div>
            <Link className="secondary-button" to="/prospects">Open prospects</Link>
          </div>
        </div>
      </section>

      <section className="content-card" aria-labelledby="growth-attention-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">In your permission scope</p>
            <h3 id="growth-attention-title">Growth attention</h3>
          </div>
          <Activity aria-hidden="true" />
        </div>
        <div className="attention-grid">
          <AttentionCard label="New leads (last 7 days)" value={growthAttention.newLeadsLast7d} />
          <AttentionCard label="Qualified open" value={growthAttention.qualifiedOpen} />
          <AttentionCard label="Onboarding open" value={growthAttention.onboardingOpen} />
          <AttentionCard
            label="Onboarding stalled (15+ days)"
            value={growthAttention.onboardingStalledOver15d}
            warn={growthAttention.onboardingStalledOver15d > 0}
          />
          <AttentionCard label="Converted (last 7 days)" value={growthAttention.convertedLast7d} />
          <AttentionCard
            label="Overdue follow-ups in scope"
            value={growthAttention.followupsOverdueInScope}
            warn={growthAttention.followupsOverdueInScope > 0}
          />
        </div>
      </section>

      {merchantAttention ? (
        <section className="content-card" aria-labelledby="merchant-attention-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Shop records</p>
              <h3 id="merchant-attention-title">Merchant attention</h3>
            </div>
            <Store aria-hidden="true" />
          </div>
          <div className="attention-grid">
            <AttentionCard label="Merchants total" value={merchantAttention.merchantsTotal} />
          </div>
        </section>
      ) : null}

      {platformAttention ? (
        <section className="content-card" aria-labelledby="platform-attention-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Platform health</p>
              <h3 id="platform-attention-title">Platform attention</h3>
            </div>
            <BarChart3 aria-hidden="true" />
          </div>
          <div className="attention-grid">
            <AttentionCard
              label="Meta channels unhealthy"
              value={platformAttention.metaChannelsUnhealthy}
              warn={platformAttention.metaChannelsUnhealthy > 0}
            />
            <AttentionCard
              label="Payment transactions stuck over 24h"
              value={platformAttention.paymentTransactionsStuckOver24h}
              warn={platformAttention.paymentTransactionsStuckOver24h > 0}
            />
            <AttentionCard
              label="Subscriptions suspended"
              value={platformAttention.subscriptionsSuspended}
              warn={platformAttention.subscriptionsSuspended > 0}
            />
          </div>
        </section>
      ) : null}

      {recentPrivilegedActions ? (
        <section className="content-card" aria-labelledby="privileged-actions-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Privilege trail</p>
              <h3 id="privileged-actions-title">Recent privileged actions</h3>
            </div>
            <ScrollText aria-hidden="true" />
          </div>
          {recentPrivilegedActions.length === 0 ? (
            <div className="inline-state empty-state compact-state">
              <p>No privileged actions have been recorded yet.</p>
            </div>
          ) : (
            <ul className="work-list">
              {recentPrivilegedActions.map((entry) => (
                <li className="work-item" key={entry.id}>
                  <div>
                    <strong>{entry.action}</strong>
                    <span className="table-subtext">
                      {entry.actor?.name || entry.actor?.userId || 'System'} · {entry.resourceType}
                    </span>
                  </div>
                  <div className="work-item">
                    <time dateTime={entry.createdAt} className="table-subtext">{formatDate(entry.createdAt, true)}</time>
                    <span className="table-subtext" title={entry.reason || 'No reason recorded'}>
                      {entry.reason ? `Reason: ${entry.reason}` : 'No reason recorded'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
