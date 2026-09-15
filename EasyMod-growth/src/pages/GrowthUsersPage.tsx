import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, RefreshCw, Search, UserPlus, Users } from 'lucide-react';
import {
  growthUsersApi,
  type GrowthRole,
  type GrowthUserRow,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

type PendingAction = 'activate' | 'suspend' | 'sessions' | 'reset' | 'role' | 'revoke' | null;

const MAX_ADMIN_REASON_LENGTH = 200;
const MAX_USER_SEARCH_LENGTH = 120;

interface RevealState {
  subject: string;
  email: string | null;
  password: string;
  expiresAt: string | null;
}

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function serverMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error && error.message.trim() ? error.message : fallback;
  return raw.replace(/[<>]/g, '').slice(0, 400);
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`status-badge status-${value.toLowerCase().replace(/_/g, '-')}`}>
      {codeLabel(value)}
    </span>
  );
}

function submitLabelFor(open: Exclude<PendingAction, null>, busy: boolean, armed: boolean): string {
  if (busy) return 'Saving';
  if (open === 'activate') return 'Activate user';
  if (open === 'role') return 'Change role';
  if (open === 'revoke') return 'Revoke access permanently';
  if (!armed) return 'Continue';
  if (open === 'suspend') return 'Confirm suspend';
  if (open === 'sessions') return 'Confirm session revocation';
  return 'Confirm password reset';
}

function UserRowActions({
  user,
  onChanged,
  onReveal,
}: {
  user: GrowthUserRow;
  onChanged: () => void;
  onReveal: (reveal: RevealState) => void;
}) {
  const { reportApiError } = useGrowthAuth();
  const [open, setOpen] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [roleDraft, setRoleDraft] = useState<GrowthRole>('GROWTH_USER');
  const [confirmWord, setConfirmWord] = useState('');
  const [armed, setArmed] = useState(false);

  function start(next: Exclude<PendingAction, null>) {
    setOpen((current) => (current === next ? null : next));
    setArmed(false);
    setError(null);
    setReason('');
    setConfirmWord('');
    setRoleDraft(user.role === 'SUPER_ADMIN' ? 'GROWTH_USER' : 'SUPER_ADMIN');
  }

  function cancel() {
    setOpen(null);
    setArmed(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open || busy) return;
    if (!reason.trim()) {
      setError('A reason is required for every user-administration action.');
      return;
    }
    if (reason.trim().length > MAX_ADMIN_REASON_LENGTH) {
      setError(`Reasons must stay within ${MAX_ADMIN_REASON_LENGTH} characters.`);
      return;
    }
    if (open === 'role' && roleDraft === user.role) {
      setError('Choose a different role to record a change.');
      return;
    }
    if (open === 'revoke' && confirmWord.trim() !== 'REVOKE') {
      setError('Type REVOKE exactly to confirm permanent access revocation.');
      return;
    }
    if ((open === 'suspend' || open === 'sessions' || open === 'reset') && !armed) {
      setArmed(true);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (open === 'activate') {
        await growthUsersApi.setStatus(user.userId, { active: true, reason: reason.trim() });
      } else if (open === 'suspend') {
        await growthUsersApi.setStatus(user.userId, { active: false, reason: reason.trim() });
      } else if (open === 'sessions') {
        await growthUsersApi.revokeSessions(user.userId, reason.trim());
      } else if (open === 'role') {
        await growthUsersApi.setRole(user.userId, { role: roleDraft, reason: reason.trim() });
      } else if (open === 'revoke') {
        await growthUsersApi.revokeAccess(user.userId, reason.trim());
      } else {
        const resetResult = await growthUsersApi.resetPassword(user.userId, reason.trim());
        onReveal({
          subject: resetResult.email || user.displayName || 'Growth OS user',
          email: resetResult.email,
          password: resetResult.initialPassword,
          expiresAt: resetResult.temporaryPasswordExpiresAt,
        });
      }
      cancel();
      onChanged();
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setArmed(false);
      setError(serverMessage(requestError, 'The action could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  const available: Array<{ key: Exclude<PendingAction, null>; label: string }> = user.status === 'revoked'
    ? []
    : [
      ...(user.status === 'suspended' ? [{ key: 'activate' as const, label: 'Activate' }] : []),
      ...(user.status === 'active' ? [{ key: 'suspend' as const, label: 'Suspend' }] : []),
      { key: 'role' as const, label: 'Change role' },
      { key: 'reset' as const, label: 'Reset password' },
      { key: 'sessions' as const, label: 'Revoke sessions' },
      { key: 'revoke' as const, label: 'Revoke access' },
    ];

  return (
    <div className="work-list">
      <div className="filter-actions">
        {available.length === 0 ? <span className="state-copy">Access revoked — no further actions.</span> : null}
        {available.map((action) => (
          <button
            key={action.key}
            className="secondary-button"
            type="button"
            disabled={busy}
            aria-expanded={open === action.key}
            onClick={() => start(action.key)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {open ? (
        <form className="action-form" onSubmit={submit}>
          <label htmlFor={`user-reason-${open}-${user.userId}`}>
            Reason for this action (required, max 200 chars)
            <textarea
              id={`user-reason-${open}-${user.userId}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setArmed(false);
              }}
              rows={2}
              maxLength={MAX_ADMIN_REASON_LENGTH}
              required
            />
          </label>
          {open === 'role' ? (
            <label htmlFor={`user-role-${user.userId}`}>
              New role
              <select
                id={`user-role-${user.userId}`}
                value={roleDraft}
                onChange={(event) => setRoleDraft(event.target.value as GrowthRole)}
              >
                <option value="SUPER_ADMIN">Super admin</option>
                <option value="GROWTH_USER">Growth user</option>
              </select>
            </label>
          ) : null}
          {open === 'revoke' ? (
            <label htmlFor={`user-revoke-confirm-${user.userId}`}>
              Type REVOKE to confirm
              <input
                id={`user-revoke-confirm-${user.userId}`}
                value={confirmWord}
                onChange={(event) => setConfirmWord(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
          ) : null}
          {armed ? <p className="field-hint">Click again to confirm this action.</p> : null}
          <div className="filter-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {submitLabelFor(open, busy, armed)}
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

// Deep-link entry from the internal search results: /growth-users?search=…
function initialSearchFromUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('search')?.slice(0, MAX_USER_SEARCH_LENGTH) ?? '';
  } catch (_error) {
    return '';
  }
}

export function GrowthUsersPage() {
  const { reportApiError } = useGrowthAuth();
  const [searchDraft, setSearchDraft] = useState(initialSearchFromUrl());
  const [searchApplied, setSearchApplied] = useState(initialSearchFromUrl());
  const [users, setUsers] = useState<GrowthUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [reveal, setReveal] = useState<RevealState | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    growthUsersApi.list(searchApplied)
      .then((nextUsers) => {
        if (active) setUsers(nextUsers);
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setError(serverMessage(requestError, 'Unable to load Growth OS users.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [searchApplied, reloadToken, reportApiError]);

  return (
    <main className="page-content" aria-labelledby="growth-users-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">User administration</p>
          <h2 id="growth-users-title">Growth OS users</h2>
          <p className="page-lede">
            Grants are visible here so access changes can be audited and reversed by Super Admins.
          </p>
        </div>
      </div>

      {reveal ? (
        <section className="content-card" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">One-time secret</p>
              <h3 id="reveal-title">Initial password for {reveal.subject}</h3>
            </div>
            <KeyRound aria-hidden="true" />
          </div>
          <p className="state-copy">
            Select the text to copy it. This password is shown once, expires {reveal.expiresAt ? formatDateTime(reveal.expiresAt) : 'within 24 hours'},
            and never displayed again by Growth OS. Share it over a trusted channel. If it is lost,
            run a password reset from this row.
          </p>
          <div className="password-reveal" aria-live="polite">{reveal.password}</div>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => setReveal(null)}>
              Done — I copied the password
            </button>
          </div>
        </section>
      ) : null}

      <section className="content-card filter-card" aria-labelledby="user-search-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Find a user</p>
            <h3 id="user-search-title">Search</h3>
          </div>
          <Search aria-hidden="true" />
        </div>
        <form
          className="filter-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setSearchApplied(searchDraft.trim().slice(0, MAX_USER_SEARCH_LENGTH));
          }}
        >
          <label htmlFor="user-query">
            Search users
            <span className="input-with-icon">
              <Search aria-hidden="true" />
              <input
                id="user-query"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value.slice(0, MAX_USER_SEARCH_LENGTH))}
                maxLength={MAX_USER_SEARCH_LENGTH}
                placeholder="Name or email"
              />
            </span>
          </label>
          <div className="filter-actions">
            <button className="primary-button" type="submit">Apply search</button>
          </div>
        </form>
      </section>

      <CreateUserPanel
        onChanged={() => setReloadToken((current) => current + 1)}
        onReveal={setReveal}
      />

      <section className="content-card" aria-labelledby="user-results-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Access grants</p>
            <h3 id="user-results-title">
              {loading ? 'Loading users' : `${users.length.toLocaleString()} user${users.length === 1 ? '' : 's'}`}
            </h3>
          </div>
          <div className="button-row">
            <Users aria-hidden="true" />
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh users"
              title="Refresh users"
              onClick={() => setReloadToken((current) => current + 1)}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="list-skeleton" aria-label="Loading users">
            {['one', 'two', 'three'].map((row) => <div className="skeleton-row" key={row} />)}
          </div>
        ) : null}
        {!loading && error ? (
          <div className="inline-state error-state" role="alert">
            <strong>Growth OS users could not be loaded.</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error && users.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No Growth OS users match this search.</strong>
            <p>Clear the search or add the first grant with the panel above.</p>
          </div>
        ) : null}
        {!loading && !error && users.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Growth OS users visible to Super Admins</caption>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">MFA</th>
                  <th scope="col">Last login</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId}>
                    <th scope="row">{user.displayName || <span className="state-copy">No display name</span>}</th>
                    <td>{user.email || 'No email on file'}</td>
                    <td>
                      <Badge value={user.role} />
                      {user.legacyRole ? (
                        <span className="table-subtext">legacy: {codeLabel(user.legacyRole)}</span>
                      ) : null}
                    </td>
                    <td><Badge value={user.status} /></td>
                    <td>{user.mfaEnabled ? 'Yes' : 'No'}</td>
                    <td>{formatDateTime(user.lastLoginAt)}</td>
                    <td>
                      <UserRowActions
                        user={user}
                        onChanged={() => setReloadToken((current) => current + 1)}
                        onReveal={setReveal}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function CreateUserPanel({
  onChanged,
  onReveal,
}: {
  onChanged: () => void;
  onReveal: (reveal: RevealState) => void;
}) {
  const { reportApiError } = useGrowthAuth();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<GrowthRole>('GROWTH_USER');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid work email address.');
      return;
    }
    if (!fullName.trim()) {
      setError('A display name is required.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required when granting Growth OS access.');
      return;
    }
    if (reason.trim().length > MAX_ADMIN_REASON_LENGTH) {
      setError(`Reasons must stay within ${MAX_ADMIN_REASON_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await growthUsersApi.create({
        email: email.trim(),
        fullName: fullName.trim(),
        role,
        reason: reason.trim(),
      });
      onReveal({
        subject: created.user.displayName || created.user.email,
        email: created.user.email,
        password: created.initialPassword,
        expiresAt: created.temporaryPasswordExpiresAt,
      });
      setEmail('');
      setFullName('');
      setRole('GROWTH_USER');
      setReason('');
      onChanged();
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setError(serverMessage(requestError, 'The user could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="content-card">
      <summary>
        <span className="eyebrow">Grant access</span>
        <span className="create-summary-title"><UserPlus aria-hidden="true" /> Add a Growth OS user</span>
      </summary>
      <p className="field-hint">
        There is no self-registration in Growth OS. The server generates a one-time initial
        password, shows it to you here exactly once, and never stores it in a viewable form. If it
        is lost, reset the password later from the user row.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <label htmlFor="create-email">
          Email
          <input
            id="create-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label htmlFor="create-full-name">
          Display name
          <input
            id="create-full-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <fieldset className="role-fieldset">
          <legend>Role</legend>
          <label htmlFor="create-role-growth">
            <input
              id="create-role-growth"
              type="radio"
              name="create-role"
              value="GROWTH_USER"
              checked={role === 'GROWTH_USER'}
              onChange={() => setRole('GROWTH_USER')}
            />
            Growth user
          </label>
          <label htmlFor="create-role-admin">
            <input
              id="create-role-admin"
              type="radio"
              name="create-role"
              value="SUPER_ADMIN"
              checked={role === 'SUPER_ADMIN'}
              onChange={() => setRole('SUPER_ADMIN')}
            />
            Super admin
          </label>
        </fieldset>
        <label htmlFor="create-reason">
          Reason (required, max 200 chars)
          <textarea
            id="create-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={MAX_ADMIN_REASON_LENGTH}
            required
          />
        </label>
        <div className="filter-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Creating' : 'Create user'}
          </button>
        </div>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </details>
  );
}
