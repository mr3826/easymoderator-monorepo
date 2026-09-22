import { useEffect, useState, type FormEvent } from 'react';
import { CalendarPlus, ListChecks } from 'lucide-react';
import { workspaceApi, type Followup, type FollowupListResponse } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDueDate() {
  return toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Follow-up data could not be loaded.';
}

export function FollowUpsPanel({ prospectId }: { prospectId: string }) {
  const { reportApiError } = useGrowthAuth();
  const [result, setResult] = useState<FollowupListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dueAt, setDueAt] = useState(defaultDueDate);
  const [action, setAction] = useState('Call');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.listFollowups({ prospectId, state: 'open' })
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
  }, [prospectId, reportApiError, reloadToken]);

  async function complete(followup: Followup) {
    setCompletingId(followup.id);
    setFormError(null);
    try {
      await workspaceApi.transitionFollowup(followup.id, 'completed');
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setFormError(errorMessage(requestError));
    } finally {
      setCompletingId(null);
    }
  }

  async function addFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const due = new Date(dueAt);
    if (!dueAt || Number.isNaN(due.getTime())) {
      setFormError('Choose a valid due date and time.');
      return;
    }
    if (!action.trim()) {
      setFormError('An action is required.');
      return;
    }
    setAdding(true);
    setFormError(null);
    try {
      await workspaceApi.createFollowup({
        prospectId,
        dueAt: due.toISOString(),
        action: action.trim(),
        note: note.trim() || null,
      });
      setNote('');
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setFormError(errorMessage(requestError));
    } finally {
      setAdding(false);
    }
  }

  const items = result?.items ?? [];

  return (
    <section className="content-card" aria-labelledby="followups-panel-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Next conversations</p>
          <h3 id="followups-panel-title">Follow-ups</h3>
        </div>
        <ListChecks aria-hidden="true" />
      </div>

      {error ? (
        <div className="inline-state error-state" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>Try again</button>
        </div>
      ) : null}

      {formError ? <div className="form-error" role="alert">{formError}</div> : null}

      {loading ? <p className="timeline-note" aria-label="Loading follow-ups">Loading follow-ups…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="inline-state empty-state compact-state">
          <p>No open follow-ups for this prospect.</p>
        </div>
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <ul className="work-list">
          {items.map((followup) => (
            <li className={followup.overdue ? 'work-item overdue' : 'work-item'} key={followup.id}>
              <div>
                <strong>{followup.action}</strong>
                <span className="table-subtext">
                  Due {formatDateTime(followup.dueAt)}
                  {followup.note ? ` · ${followup.note}` : ''}
                </span>
              </div>
              <div className="button-row">
                {followup.overdue ? <span className="status-badge status-overdue">overdue</span> : null}
                <button
                  className="secondary-button"
                  type="button"
                  disabled={completingId !== null || adding}
                  onClick={() => void complete(followup)}
                >
                  {completingId === followup.id ? 'Completing' : 'Complete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="action-form" onSubmit={addFollowup} aria-label="Schedule a follow-up">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Plan ahead</p>
            <h4>Schedule next follow-up</h4>
          </div>
          <CalendarPlus aria-hidden="true" />
        </div>
        <label htmlFor="panel-followup-due">
          Due date *
          <input
            id="panel-followup-due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            required
          />
        </label>
        <label htmlFor="panel-followup-action">
          Action *
          <input
            id="panel-followup-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label htmlFor="panel-followup-note">
          Note
          <textarea
            id="panel-followup-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
          />
        </label>
        <button className="primary-button" type="submit" disabled={adding || completingId !== null}>
          {adding ? 'Scheduling' : 'Schedule follow-up'}
        </button>
      </form>
    </section>
  );
}
