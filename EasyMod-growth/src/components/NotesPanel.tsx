import { useEffect, useState, type FormEvent } from 'react';
import { MessageSquareText, Trash2 } from 'lucide-react';
import {
  ApiError,
  workspaceApi,
  type InternalNote,
  type InternalNoteListResponse,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { usePermission } from '@/auth/usePermission';

const MAX_NOTE_LENGTH = 4000;

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Internal notes could not be loaded.';
}

export function NotesPanel({ targetType, targetId }: { targetType: InternalNote['targetType']; targetId: string }) {
  const { reportApiError, session } = useGrowthAuth();
  const canManageNotes = usePermission('growth_os.notes.manage');
  const [result, setResult] = useState<InternalNoteListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const allowed = canManageNotes;

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.listNotes(targetType, targetId)
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
  }, [allowed, reportApiError, reloadToken, targetId, targetType]);

  if (!allowed) return null;

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) {
      setFormError('A note cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_NOTE_LENGTH) {
      setFormError(`Notes are limited to ${MAX_NOTE_LENGTH} characters.`);
      return;
    }
    setBusyId('new');
    setFormError(null);
    try {
      await workspaceApi.createNote({ targetType, targetId, body: trimmed });
      setBody('');
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setFormError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  }

  async function removeNote(note: InternalNote) {
    setBusyId(note.id);
    setFormError(null);
    try {
      await workspaceApi.deleteNote(note.id);
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setFormError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  }

  const notes = result?.items ?? [];

  return (
    <section className="content-card" aria-labelledby="notes-panel-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Internal notes — never visible to merchants</p>
          <h3 id="notes-panel-title">Notes</h3>
        </div>
        <MessageSquareText aria-hidden="true" />
      </div>

      {error ? (
        <div className="inline-state error-state" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>Try again</button>
        </div>
      ) : null}

      {loading ? <p className="timeline-note" aria-label="Loading notes">Loading notes…</p> : null}
      {!loading && !error && notes.length === 0 ? (
        <div className="inline-state empty-state compact-state">
          <p>No internal notes yet.</p>
        </div>
      ) : null}
      {!loading && notes.length > 0 ? (
        <ul className="work-list">
          {notes.map((note) => (
            <li className="work-item" key={note.id}>
              <div>
                <p>{note.body}</p>
                <span className="table-subtext">
                  {note.authorUserId || 'Unknown author'} · {formatDate(note.createdAt)}
                </span>
              </div>
              {note.authorUserId && note.authorUserId === session?.internalUserId ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId !== null}
                  aria-label={`Delete note ${formatDate(note.createdAt)}`}
                  onClick={() => void removeNote(note)}
                >
                  <Trash2 aria-hidden="true" />
                  <span>Delete</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form className="action-form" onSubmit={addNote} aria-label="Add an internal note">
        {formError ? <div className="form-error" role="alert">{formError}</div> : null}
        <label htmlFor="new-note-body">
          New note
          <textarea
            id="new-note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="Context only teammates in Growth OS will see"
          />
        </label>
        <button className="primary-button" type="submit" disabled={busyId !== null}>
          {busyId === 'new' ? 'Adding' : 'Add note'}
        </button>
      </form>
    </section>
  );
}
