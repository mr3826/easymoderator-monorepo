import { useEffect, useState } from 'react';
import { Activity, CreditCard, RefreshCw, Share2, Store, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminApi, type OperationsResponse } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

type OpsWindow = 7 | 30;

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'Not measured';
  return new Intl.NumberFormat().format(value);
}

function formatGenerated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function serverMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error && error.message.trim() ? error.message : fallback;
  return raw.replace(/[<>]/g, '').slice(0, 400);
}

export function OperationsPage() {
  const { reportApiError } = useGrowthAuth();
  const [windowDays, setWindowDays] = useState<OpsWindow>(7);
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi.operations(windowDays)
      .then((nextData) => {
        if (active) setData(nextData);
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setError(serverMessage(requestError, 'Unable to load the operations snapshot.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [windowDays, reloadToken, reportApiError]);

  const subscriptionEntries = Object.entries(data?.subscriptions ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const stuckPayments = data?.payments.stuckOver24h ?? 0;
  const failedPayments = data?.payments.failedInWindow ?? 0;
  const metaAttention = data?.meta.channelsNeedingAttention ?? 0;

  return (
    <main className="page-content" aria-labelledby="operations-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform health</p>
          <h2 id="operations-title">Operations</h2>
          <p className="page-lede">
            Counts only, scoped to the selected window. “Attention” means the number is above zero.
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Refresh operations snapshot"
          title="Refresh operations snapshot"
          onClick={() => setReloadToken((current) => current + 1)}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      <div className="tab-row" role="group" aria-label="Report window">
        {([7, 30] as const).map((days) => (
          <button
            key={days}
            type="button"
            className={windowDays === days ? 'active' : undefined}
            aria-pressed={windowDays === days}
            onClick={() => setWindowDays(days)}
          >
            Last {days} days
          </button>
        ))}
      </div>

      {loading ? (
        <div className="list-skeleton" aria-label="Loading operations snapshot">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="inline-state error-state" role="alert">
          <strong>The operations snapshot could not be loaded.</strong>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
            Try again
          </button>
        </div>
      ) : null}
      {!loading && !error && data ? (
        <>
          <div className="attention-grid">
            <section className="content-card attention-card" aria-labelledby="ops-merchants-title">
              <Store aria-hidden="true" />
              <p className="eyebrow" id="ops-merchants-title">Merchants</p>
              <span className="metric">{formatNumber(data.merchants.total)}</span>
              <span className="table-subtext">
                {data.merchants.newInWindow === 0
                  ? 'No new merchants in the window.'
                  : `${formatNumber(data.merchants.newInWindow)} new in the last ${data.windowDays} days`}
              </span>
            </section>

            <section className="content-card attention-card" aria-labelledby="ops-payments-title">
              <CreditCard aria-hidden="true" />
              <p className="eyebrow" id="ops-payments-title">Payments</p>
              <span className={`metric${stuckPayments > 0 ? ' warn' : ''}`}>{formatNumber(stuckPayments)}</span>
              <span className="table-subtext">Stuck over 24h — attention needed when above zero.</span>
              <span className={`metric${failedPayments > 0 ? ' warn' : ''}`}>{formatNumber(failedPayments)}</span>
              <span className="table-subtext">Failed in the window.</span>
            </section>

            <section className="content-card attention-card" aria-labelledby="ops-meta-title">
              <Share2 aria-hidden="true" />
              <p className="eyebrow" id="ops-meta-title">Meta channels</p>
              <span className={`metric${metaAttention > 0 ? ' warn' : ''}`}>{formatNumber(metaAttention)}</span>
              <span className="table-subtext">Needing attention — above zero means investigate.</span>
              <Link className="secondary-button" to="/merchants">Investigate merchants</Link>
            </section>

            <section className="content-card attention-card" aria-labelledby="ops-ai-title">
              <Sparkles aria-hidden="true" />
              <p className="eyebrow" id="ops-ai-title">AI</p>
              <span className="metric">{formatNumber(data.ai.messagesInWindow)}</span>
              <span className="table-subtext">AI messages in the window.</span>
              <span className="metric">{formatNumber(data.ai.conversationsInWindow)}</span>
              <span className="table-subtext">Conversations touched by AI.</span>
            </section>
          </div>

          <section className="content-card" aria-labelledby="ops-subs-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Subscriptions</p>
                <h3 id="ops-subs-title">Subscription states</h3>
              </div>
              <Activity aria-hidden="true" />
            </div>
            {subscriptionEntries.length === 0 ? (
              <div className="inline-state empty-state compact-state"><p>No subscription states were reported in this snapshot.</p></div>
            ) : (
              <ul className="work-list">
                {subscriptionEntries.map(([status, count]) => (
                  <li className="work-item" key={status}>
                    <span className="status-badge">{codeLabel(status)}</span>
                    <strong>{formatNumber(count)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="field-hint">Snapshot generated {formatGenerated(data.generatedAt)} for the last {data.windowDays} days.</p>
        </>
      ) : null}

      {!loading && !error && !data ? (
        <div className="inline-state empty-state">
          <strong>No operations data returned.</strong>
          <p>The platform metrics service replied without a snapshot. Retry in a moment.</p>
          <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
            Try again
          </button>
        </div>
      ) : null}
    </main>
  );
}
