import { useEffect, useState, type FormEvent } from 'react';
import { CalendarPlus, ListChecks } from 'lucide-react';
import {
  FOLLOWUP_OUTCOME_LABELS,
  workspaceApi,
  type Followup,
  type FollowupListResponse,
  type FollowupOutcome,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { usePermission } from '@/auth/usePermission';
import { fromBusinessDateTimeLocal, formatGrowthDateTime, toBusinessDateTimeLocal } from '@/growthTime';

function toDateTimeLocal(date: Date) {
  return toBusinessDateTimeLocal(date.toISOString());
}

function defaultDueDate() {
  return toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Follow-up data could not be loaded.';
}

export function FollowUpsPanel({ prospectId }: { prospectId: string }) {
  const { reportApiError } = useGrowthAuth();
  const canManage = usePermission('growth_os.followups.manage');
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
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcomeChoice, setOutcomeChoice] = useState<FollowupOutcome | ''>('');
  const [outcomeReason, setOutcomeReason] = useState('');

  useEffect(() => {
    if (!canManage) return undefined;
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
  }, [canManage, prospectId, reportApiError, reloadToken]);

  async function complete(followup: Followup) {
    if (!outcomeChoice) {
      setFormError('Choose an outcome before completing this follow-up.');
      return;
    }
    setCompletingId(followup.id);
    setFormError(null);
    try {
      await workspaceApi.transitionFollowup(followup.id, 'completed', {
        outcome: outcomeChoice,
        reason: outcomeReason.trim() || undefined,
      });
      setOutcomeFor(null);
      setOutcomeChoice('');
      setOutcomeReason('');
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setFormError(errorMessage(requestError));
    } finally {
      setCompletingId(null);
    }
  }

  function openOutcome(followup: Followup) {
    setFormError(null);
    setOutcomeFor(followup.id);
    setOutcomeChoice('');
    setOutcomeReason('');
  }

  async function addFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Validate with the same business-zone parser used for the payload so the
    // guard can never disagree with what actually gets submitted.
    const due = fromBusinessDateTimeLocal(dueAt);
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

  if (!canManage) return null;

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
                  Due {formatGrowthDateTime(followup.dueAt)}
                  {followup.note ? ` · ${followup.note}` : ''}
                </span>
              </div>
              {outcomeFor === followup.id ? (
                <form
                  className="action-form"
                  aria-label={`Record outcome for ${followup.action}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void complete(followup);
                  }}
                >
                  <label htmlFor={`panel-outcome-${followup.id}`}>
                    Outcome (required)
                    <select
                      id={`panel-outcome-${followup.id}`}
                      value={outcomeChoice}
                      onChange={(event) => setOutcomeChoice(event.target.value as FollowupOutcome)}
                      required
                    >
                      <option value="" disabled>Choose what happened…</option>
                      {(Object.keys(FOLLOWUP_OUTCOME_LABELS) as FollowupOutcome[]).map((outcome) => (
                        <option key={outcome} value={outcome}>{FOLLOWUP_OUTCOME_LABELS[outcome]}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor={`panel-outcome-reason-${followup.id}`}>
                    Reason (optional, max 200 chars)
                    <input
                      id={`panel-outcome-reason-${followup.id}`}
                      type="text"
                      maxLength={200}
                      value={outcomeReason}
                      onChange={(event) => setOutcomeReason(event.target.value)}
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="submit" disabled={completingId !== null || adding}>
                      {completingId === followup.id ? 'Completing' : 'Record and complete'}
                    </button>
                    <button className="secondary-button" type="button" disabled={completingId !== null} onClick={() => setOutcomeFor(null)}>
                      Close
                    </button>
                  </div>
                </form>
              ) : (
                <div className="button-row">
                  {followup.overdue ? <span className="status-badge status-overdue">overdue</span> : null}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={completingId !== null || adding}
                    onClick={() => openOutcome(followup)}
                  >
                    Complete
                  </button>
                </div>
              )}
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
