import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  workspaceApi,
  type Followup,
  type FollowupListResponse,
  type FollowupState,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { fromBusinessDateTimeLocal, formatGrowthDateTime, toBusinessDateTimeLocal } from '@/growthTime';

const PAGE_SIZE = 50;

const STATE_TABS: Array<{ value: FollowupState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'due_today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Follow-ups could not be loaded. Please try again.';
}

function toDateTimeLocal(value: string) {
  return toBusinessDateTimeLocal(value);
}

function statusBadge(followup: Followup) {
  if (followup.status === 'open' && followup.overdue) {
    return <span className="status-badge status-overdue">overdue</span>;
  }
  return <span className="status-badge">{followup.status}</span>;
}

type ActionKey = { id: string; kind: 'complete' | 'cancel' | 'reschedule' };

export function FollowUpsPage({ scope }: { scope: 'mine' | 'all' }) {
  const { reportApiError } = useGrowthAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialState = searchParams.get('state');
  const [state, setState] = useState<FollowupState>(
    initialState && STATE_TABS.some((tab) => tab.value === initialState)
      ? initialState as FollowupState
      : 'open',
  );
  const initialPage = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const [page, setPage] = useState(initialPage);
  const appliedUrlRef = useRef(searchParams.toString());
  const [result, setResult] = useState<FollowupListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [actionState, setActionState] = useState<ActionKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDue, setRescheduleDue] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.listFollowups({
      state,
      owner: scope === 'mine' ? 'me' : undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((nextResult) => {
        if (active) setResult(nextResult);
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
  }, [page, reportApiError, reloadToken, scope, state]);

  function reload() {
    setRescheduleId(null);
    setActionError(null);
    setReloadToken((current) => current + 1);
  }

  // Query-only navigation (Home drill links, back/forward) must re-derive the
  // tab and page instead of keeping stale mount-time state.
  useEffect(() => {
    const current = searchParams.toString();
    if (current === appliedUrlRef.current) return;
    appliedUrlRef.current = current;
    const urlState = searchParams.get('state');
    if (urlState && STATE_TABS.some((tab) => tab.value === urlState)) {
      setState(urlState as FollowupState);
    }
    const urlPage = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
    setPage(urlPage);
  }, [searchParams]);

  function navigateView(nextState: FollowupState, nextPage: number) {
    setState(nextState);
    setPage(nextPage);
    setRescheduleId(null);
    setActionError(null);
    const nextParams = new URLSearchParams();
    nextParams.set('state', nextState);
    if (nextPage > 1) nextParams.set('page', String(nextPage));
    appliedUrlRef.current = nextParams.toString();
    setSearchParams(nextParams);
  }

  function selectTab(nextState: FollowupState) {
    navigateView(nextState, 1);
  }

  async function runAction(followup: Followup, kind: ActionKey['kind']) {
    setActionState({ id: followup.id, kind });
    setActionError(null);
    try {
      if (kind === 'reschedule') {
        const dueDate = fromBusinessDateTimeLocal(rescheduleDue);
        if (!rescheduleDue || Number.isNaN(dueDate.getTime())) {
          setActionError('Choose a valid new due date and time.');
          return;
        }
        await workspaceApi.updateFollowup(followup.id, { dueAt: dueDate.toISOString() });
      } else {
        await workspaceApi.transitionFollowup(followup.id, kind === 'complete' ? 'completed' : 'cancelled');
      }
      setRescheduleId(null);
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setActionError(errorMessage(requestError));
    } finally {
      setActionState(null);
    }
  }

  function startReschedule(followup: Followup) {
    setActionError(null);
    setRescheduleId(followup.id);
    setRescheduleDue(toDateTimeLocal(followup.dueAt));
  }

  function submitReschedule(event: FormEvent<HTMLFormElement>, followup: Followup) {
    event.preventDefault();
    void runAction(followup, 'reschedule');
  }

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = result ? Math.max(1, Math.ceil(total / (result.pageSize || PAGE_SIZE))) : 1;
  const overdueInView = items.filter((item) => item.status === 'open' && item.overdue).length;
  const busy = actionState !== null;

  return (
    <main className="page-content" aria-labelledby="followups-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{scope === 'mine' ? 'Assigned to you' : 'Team queue'}</p>
          <h1 id="followups-title">{scope === 'mine' ? 'My Work' : 'Follow-ups'}</h1>
          <p className="page-lede">
            {loading ? 'Loading the follow-up queue.' : `${overdueInView} overdue in this view.`}
          </p>
        </div>
        <div className="button-row">
          <Link className="secondary-button" to={scope === 'mine' ? '/follow-ups' : '/my-work'}>
            {scope === 'mine' ? 'View team follow-ups' : 'View my work'}
          </Link>
          <button className="icon-button" type="button" aria-label="Refresh follow-ups" title="Refresh follow-ups" onClick={reload}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      {actionError ? <div className="inline-state error-state" role="alert"><p>{actionError}</p></div> : null}

      <section className="content-card" aria-labelledby="followups-list-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{loading ? 'Loading follow-ups' : `${total.toLocaleString()} follow-up${total === 1 ? '' : 's'}`}</p>
            <h3 id="followups-list-title">{STATE_TABS.find((tab) => tab.value === state)?.label ?? 'Follow-ups'}</h3>
          </div>
        </div>

        <div className="tab-row" role="group" aria-label="Follow-up state filters">
          {STATE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={tab.value === state ? 'active' : undefined}
              aria-pressed={tab.value === state}
              onClick={() => selectTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="list-skeleton" aria-label="Loading follow-ups">
            {['one', 'two', 'three', 'four', 'five'].map((row) => <div className="skeleton-row" key={row} />)}
          </div>
        ) : null}
        {!loading && error ? (
          <div className="inline-state error-state" role="alert">
            <strong>Follow-ups could not be loaded.</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={reload}>Try again</button>
          </div>
        ) : null}
        {!loading && !error && result && items.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No follow-ups in this view.</strong>
            <p>Schedule the next conversation from a prospect record and it will appear here.</p>
            <Link className="secondary-button" to="/prospects">Go to prospects</Link>
          </div>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Follow-ups matching the selected state filter</caption>
                <thead>
                  <tr>
                    <th scope="col">Follow-up</th>
                    <th scope="col">Prospect</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((followup) => (
                    <tr key={followup.id}>
                      <th scope="row">
                        {followup.action}
                        {followup.note ? <span className="table-subtext">{followup.note}</span> : null}
                      </th>
                      <td>
                        <Link className="table-link" to={`/prospects/${encodeURIComponent(followup.prospectId)}`}>
                          {followup.prospectName || 'View prospect'}
                        </Link>
                      </td>
                      <td>
                        <time dateTime={followup.dueAt}>{formatGrowthDateTime(followup.dueAt)}</time>
                      </td>
                      <td>{statusBadge(followup)}</td>
                      <td>
                        {followup.status === 'open' ? (
                          rescheduleId === followup.id ? (
                            <form className="action-form" onSubmit={(event) => submitReschedule(event, followup)}>
                              <label htmlFor={`reschedule-due-${followup.id}`}>
                                New due date
                                <input
                                  id={`reschedule-due-${followup.id}`}
                                  type="datetime-local"
                                  value={rescheduleDue}
                                  onChange={(event) => setRescheduleDue(event.target.value)}
                                  required
                                />
                              </label>
                              <div className="button-row">
                                <button className="primary-button" type="submit" disabled={busy}>
                                  {actionState?.id === followup.id ? 'Saving' : 'Save due date'}
                                </button>
                                <button className="secondary-button" type="button" disabled={busy} onClick={() => setRescheduleId(null)}>
                                  Close
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="button-row">
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={busy}
                                onClick={() => void runAction(followup, 'complete')}
                              >
                                {actionState?.id === followup.id && actionState.kind === 'complete' ? 'Completing' : 'Complete'}
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={busy}
                                onClick={() => void runAction(followup, 'cancel')}
                              >
                                {actionState?.id === followup.id && actionState.kind === 'cancel' ? 'Cancelling' : 'Cancel'}
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={busy}
                                onClick={() => startReschedule(followup)}
                              >
                                Reschedule
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="table-subtext">
                            {followup.status === 'completed' && followup.completedAt ? `Completed ${formatGrowthDateTime(followup.completedAt)}` : followup.status === 'cancelled' ? 'Cancelled (no completion time)' : 'No actions'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination" aria-label="Follow-up pages">
              <span>Page {result?.page ?? 1} of {totalPages}</span>
              <div className="pagination-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => navigateView(state, Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => navigateView(state, page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
