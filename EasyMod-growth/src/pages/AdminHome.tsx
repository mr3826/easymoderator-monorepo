import { useEffect, useState } from 'react';
import { Activity, KeyRound, ScrollText, ShieldCheck, Store, UserCog } from 'lucide-react';
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
    : 'The admin attention overview could not be loaded. Please try again.';
}

type AttentionTone = 'warn' | 'neutral';

function SignalCard({ label, value, tone, note, to, toLabel }: {
  label: string;
  value: number;
  tone: AttentionTone;
  note: string;
  to?: string;
  toLabel?: string;
}) {
  return (
    <div className="attention-card signal-card">
      <span className={tone === 'warn' ? 'metric warn' : 'metric'}>{(value ?? 0).toLocaleString()}</span>
      <strong>{label}</strong>
      <p className="table-subtext">{note}</p>
      {to ? <Link className="table-link" to={to}>{toLabel || 'Open'}</Link> : null}
    </div>
  );
}

export function AdminHome() {
  const { reportApiError, session } = useGrowthAuth();
  const canUsers = session?.permissions.includes('growth_os.admin.users.read') ?? false;
  const canAudit = session?.permissions.includes('growth_os.admin.audit.read') ?? false;
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
      <MessageState eyebrow="Admin Control" title="Attention overview is unavailable">
        <p>{error || 'No overview data was returned.'}</p>
        <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
          Try again
        </button>
      </MessageState>
    );
  }

  const { platformAttention, merchantAttention, growthAttention, recentPrivilegedActions } = home;
  const hasAttention = platformAttention || growthAttention;

  return (
    <main className="page-content" aria-labelledby="admin-home-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Admin Control</p>
          <h1 id="admin-home-title">Attention</h1>
          <p className="page-lede">
            What needs investigation, who is affected, and which authorized action to take.
            Aggregate counts stay aggregates unless a record-level view exists.
          </p>
        </div>
        <div className="button-row">
          <button className="icon-button" type="button" aria-label="Refresh overview" title="Refresh overview" onClick={() => setReloadToken((current) => current + 1)}>
            <Activity aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="table-subtext">Generated {formatDate(home.generatedAt, true)}</p>

      {platformAttention ? (
        <section className="content-card" aria-labelledby="platform-signals-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Platform signals</p>
              <h3 id="platform-signals-title">Operational attention</h3>
              <p className="table-subtext">From Operations, last 7 days. These counts are platform-wide.</p>
            </div>
            <ShieldCheck aria-hidden="true" />
          </div>
          <div className="attention-grid">
            <SignalCard
              label="Payment transactions stuck over 24h"
              value={platformAttention.paymentTransactionsStuckOver24h}
              tone={platformAttention.paymentTransactionsStuckOver24h > 0 ? 'warn' : 'neutral'}
              note="No record-level merchant identification is available for this signal; investigate via Operations detail."
              to="/operations"
              toLabel="Open Operations"
            />
            <SignalCard
              label="Meta channels needing attention"
              value={platformAttention.metaChannelsUnhealthy}
              tone={platformAttention.metaChannelsUnhealthy > 0 ? 'warn' : 'neutral'}
              note="Expired, revoked, or errored channel tokens. Open a merchant record to see its own channels."
              to="/merchants"
              toLabel="Open merchants"
            />
            <SignalCard
              label="Subscriptions suspended"
              value={platformAttention.subscriptionsSuspended}
              tone={platformAttention.subscriptionsSuspended > 0 ? 'warn' : 'neutral'}
              note="The merchant list shows plan and status per merchant; open a record before any authorized action."
              to="/merchants"
              toLabel="Open merchants"
            />
          </div>
        </section>
      ) : null}

      {growthAttention ? (
        <section className="content-card" aria-labelledby="stuck-merchants-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Before first AI activation</p>
              <h3 id="stuck-merchants-title">Merchants needing support investigation</h3>
              <p className="table-subtext">
                Leads stalled between qualification and activation. If the source data cannot name a
                blocker, the record is marked for investigation — never a fabricated cause.
              </p>
            </div>
            <Store aria-hidden="true" />
          </div>
          <div className="attention-grid">
            <SignalCard
              label="Onboarding stalled 15+ days"
              value={growthAttention.onboardingStalledOver15d}
              tone={growthAttention.onboardingStalledOver15d > 0 ? 'warn' : 'neutral'}
              note="Drill into exactly these records; every row links to the prospect ledger."
              to={`/prospects?status=onboarding&stalledBefore=${encodeURIComponent(home.windows.stalledBefore)}`}
              toLabel="View stalled cohort"
            />
            <SignalCard
              label="Qualified stalled 15+ days"
              value={growthAttention.qualifiedStalledOver15d}
              tone={growthAttention.qualifiedStalledOver15d > 0 ? 'warn' : 'neutral'}
              note="Qualified but not started onboarding; the next step is owned follow-up."
              to={`/prospects?status=qualified&stalledBefore=${encodeURIComponent(home.windows.stalledBefore)}`}
              toLabel="View stalled cohort"
            />
            {merchantAttention ? (
              <SignalCard
                label="Merchants on platform"
                value={merchantAttention.merchantsTotal}
                tone="neutral"
                note="Full Merchant 360 records are available from the merchant list."
                to="/merchants"
                toLabel="Open merchants"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {(canUsers || canAudit) ? (
        <section className="content-card" aria-labelledby="team-access-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Internal accounts</p>
              <h3 id="team-access-title">Team &amp; access</h3>
              <p className="table-subtext">
                Staff access changes run through Team &amp; Access with a reason and full MFA
                enforcement; nothing here is one-click irreversible.
              </p>
            </div>
            <UserCog aria-hidden="true" />
          </div>
          <div className="button-row">
            {canUsers ? (
              <Link className="secondary-button" to="/growth-users">
                <UserCog aria-hidden="true" />
                <span>Manage growth staff</span>
              </Link>
            ) : null}
            {canUsers ? (
              <Link className="secondary-button" to="/access-control">
                <KeyRound aria-hidden="true" />
                <span>Review access model</span>
              </Link>
            ) : null}
            {canAudit ? (
              <Link className="secondary-button" to="/audit">
                <ScrollText aria-hidden="true" />
                <span>Open audit trail</span>
              </Link>
            ) : null}
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
          {hasAttention ? null : (
            <p className="table-subtext">No attention signals were returned for this account.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
