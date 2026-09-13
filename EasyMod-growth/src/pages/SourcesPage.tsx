import { useEffect, useState } from 'react';
import { RefreshCw, Tags } from 'lucide-react';
import { Link } from 'react-router-dom';
import { workspaceApi, type GrowthAnalyticsResponse, type ProspectSource } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState, MessageState } from '@/components/states';

const WINDOW_DAYS = 90;

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Source analytics could not be loaded. Please try again.';
}

interface SourceRow {
  source: ProspectSource;
  leads: number;
  activated: number;
}

function buildRows(data: GrowthAnalyticsResponse): SourceRow[] {
  const keys = new Set<string>([
    ...Object.keys(data.bySource ?? {}),
    ...Object.keys(data.activatedBySource ?? {}),
  ]);
  return [...keys]
    .map((source) => ({
      source: source as ProspectSource,
      leads: data.bySource[source as ProspectSource] ?? 0,
      activated: data.activatedBySource[source as ProspectSource] ?? 0,
    }))
    .sort((left, right) => right.leads - left.leads || left.source.localeCompare(right.source));
}

function rateLabel(row: SourceRow) {
  if (row.leads <= 0) return '—';
  return `${Math.round((row.activated / row.leads) * 1000) / 10}%`;
}

export function SourcesPage() {
  const { reportApiError } = useGrowthAuth();
  const [data, setData] = useState<GrowthAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.growthAnalytics(WINDOW_DAYS)
      .then((nextData) => {
        if (active) setData(nextData);
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

  if (error || !data) {
    return (
      <MessageState eyebrow="Acquisition attribution" title="Sources unavailable">
        <p>{error || 'No analytics window was returned.'}</p>
        <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
          Try again
        </button>
      </MessageState>
    );
  }

  const rows = buildRows(data);

  return (
    <main className="page-content" aria-labelledby="sources-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Acquisition attribution</p>
          <h1 id="sources-title">Sources</h1>
          <p className="page-lede">Leads and activations per controlled source over the last {WINDOW_DAYS} days.</p>
        </div>
        <div className="button-row">
          <button className="icon-button" type="button" aria-label="Refresh source analytics" title="Refresh source analytics" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      <section className="content-card" aria-labelledby="source-table-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Source of record</p>
            <h3 id="source-table-title">Leads by source</h3>
          </div>
          <Tags aria-hidden="true" />
        </div>
        <p className="field-hint">
          Each prospect carries exactly one controlled source value captured at creation. Source changes are
          audited, and free-text context lives in the source detail field, never in the attribution value.
        </p>
        {rows.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No leads were recorded in this window.</strong>
            <p>Capture prospects from the ledger and their source attribution will appear here.</p>
            <Link className="secondary-button" to="/prospects">Go to prospects</Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Leads, activations, and activation rate by acquisition source</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Leads</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Activation rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.source}>
                    <th scope="row">
                      <Link className="table-link" to={`/prospects?source=${encodeURIComponent(row.source)}`}>
                        {codeLabel(row.source)}
                      </Link>
                    </th>
                    <td>{row.leads.toLocaleString()}</td>
                    <td>{row.activated.toLocaleString()}</td>
                    <td>
                      <span className="source-code">{rateLabel(row)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
