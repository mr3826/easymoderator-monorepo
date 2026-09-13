import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { growthApi, type ProspectListItem, type ProspectStatus } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

const COLUMNS = ['new', 'contacted', 'qualifying', 'qualified', 'onboarding', 'converted'] as const satisfies readonly ProspectStatus[];
const LOST_STATUSES = ['disqualified', 'unreachable'] as const satisfies readonly ProspectStatus[];
const PAGE_SIZE = 25;

type ColumnKey = (typeof COLUMNS)[number] | (typeof LOST_STATUSES)[number];
type AllColumnKey = ColumnKey;

interface ColumnState {
  loading: boolean;
  error: string | null;
  total: number;
  items: ProspectListItem[];
}

const COLUMN_LABELS: Record<AllColumnKey, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  onboarding: 'Onboarding',
  converted: 'Converted',
  disqualified: 'Disqualified',
  unreachable: 'Unreachable',
};

function emptyColumn(loading = true): ColumnState {
  return { loading, error: null, total: 0, items: [] };
}

function initialColumns(): Record<AllColumnKey, ColumnState> {
  return Object.fromEntries(
    [...COLUMNS, ...LOST_STATUSES].map((key) => [key, emptyColumn()]),
  ) as Record<AllColumnKey, ColumnState>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'This column could not be loaded.';
}

function statusClass(status: ProspectStatus) {
  return `status-${status.replace(/_/g, '-')}`;
}

function ProspectLinkItem({ prospect }: { prospect: ProspectListItem }) {
  return (
    <li className="work-item">
      <div>
        <Link className="table-link" to={`/prospects/${encodeURIComponent(prospect.id)}`}>
          {prospect.businessName}
        </Link>
        <span className={`status-badge ${statusClass(prospect.status)}`}>{prospect.status.replace(/_/g, ' ')}</span>
      </div>
      <span className="table-subtext">{prospect.ownerUserId ? 'Assigned' : 'Unassigned'}</span>
    </li>
  );
}

function ColumnCard({ status, state, onRetry }: { status: AllColumnKey; state: ColumnState; onRetry: () => void }) {
  return (
    <section className="content-card pipeline-column" aria-labelledby={`column-${status}-title`}>
      <h2 id={`column-${status}-title`}>
        {COLUMN_LABELS[status]}{' '}
        <span className="count">{state.loading ? '…' : state.total.toLocaleString()}</span>
      </h2>
      {state.error ? (
        <div className="inline-state error-state" role="alert">
          <p>{state.error}</p>
          <button className="secondary-button" type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <p className="timeline-note">No prospects in this stage.</p>
      ) : null}
      {state.items.length > 0 ? (
        <>
          <ul className="work-list">
            {state.items.map((prospect) => <ProspectLinkItem key={prospect.id} prospect={prospect} />)}
          </ul>
          {state.total > state.items.length ? (
            <p className="table-subtext">Showing {state.items.length} of {state.total.toLocaleString()}.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function PipelinePage() {
  const { reportApiError } = useGrowthAuth();
  const [columns, setColumns] = useState<Record<AllColumnKey, ColumnState>>(initialColumns);
  const [reloadToken, setReloadToken] = useState(0);
  const [lostOpen, setLostOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const keys: AllColumnKey[] = [...COLUMNS, ...LOST_STATUSES];
    setColumns((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = emptyColumn();
      return next;
    });

    Promise.allSettled(keys.map((key) => growthApi.getProspects({ status: key, pageSize: PAGE_SIZE })))
      .then((results) => {
        if (!active) return;
      const next = {} as Record<AllColumnKey, ColumnState>;
      let sessionReported = false;
      results.forEach((result, index) => {
        const key = keys[index];
        if (result.status === 'fulfilled') {
          next[key] = { loading: false, error: null, total: result.value.total, items: result.value.items };
          return;
        }
        if (!sessionReported) sessionReported = reportApiError(result.reason);
        if (sessionReported) {
          next[key] = emptyColumn(false);
          return;
        }
        next[key] = {
          loading: false,
          error: errorMessage(result.reason),
          total: 0,
          items: [],
        };
      });
      setColumns(next);
      });

    return () => {
      active = false;
    };
  }, [reloadToken, reportApiError]);

  const lostTotal = LOST_STATUSES.reduce((sum, key) => sum + (columns[key].loading ? 0 : columns[key].total), 0);
  const lostLoading = LOST_STATUSES.some((key) => columns[key].loading);
  const lostItems = LOST_STATUSES.flatMap((key) => columns[key].items);

  return (
    <main className="page-content" aria-labelledby="pipeline-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Status snapshot</p>
          <h1 id="pipeline-title">Pipeline</h1>
          <p className="page-lede">Prospects grouped by their current lifecycle stage in your permission scope.</p>
        </div>
      </div>

      <div className="pipeline-board">
        {COLUMNS.map((key) => (
          <ColumnCard key={key} status={key} state={columns[key]} onRetry={() => setReloadToken((current) => current + 1)} />
        ))}
      </div>

      <section className="content-card pipeline-lost" aria-labelledby="lost-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Closed without activation</p>
            <h2 id="lost-title">Lost ({lostLoading ? 'loading…' : lostTotal.toLocaleString()})</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={lostLoading}
            aria-expanded={lostOpen}
            onClick={() => setLostOpen((current) => !current)}
          >
            {lostOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        {lostOpen ? (
          lostLoading ? null : lostItems.length === 0 ? (
            <p className="timeline-note">No disqualified or unreachable prospects recorded.</p>
          ) : (
            LOST_STATUSES.map((key) => (
              <section key={key} aria-labelledby={`lost-${key}-title`} className="pipeline-lost-group">
                <h3 id={`lost-${key}-title`}>{COLUMN_LABELS[key]}</h3>
                {columns[key].error ? (
                  <div className="inline-state error-state" role="alert">
                    <p>{columns[key].error}</p>
                    <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>Try again</button>
                  </div>
                ) : null}
                {!columns[key].error && columns[key].items.length === 0 ? (
                  <p className="timeline-note">None recorded.</p>
                ) : null}
                {columns[key].items.length > 0 ? (
                  <ul className="work-list">
                    {columns[key].items.map((prospect) => <ProspectLinkItem key={prospect.id} prospect={prospect} />)}
                  </ul>
                ) : null}
              </section>
            ))
          )
        ) : null}
      </section>
    </main>
  );
}
