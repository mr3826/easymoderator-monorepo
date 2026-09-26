import { useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarPlus, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getConflictingProspectId,
  growthApi,
  PROSPECT_SOURCES,
  workspaceApi,
  type ProspectDuplicateMatch,
  type ProspectListItem,
  type ProspectSource,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { usePermission } from '@/auth/usePermission';
import { fromBusinessDateTimeLocal, toBusinessDateTimeLocal } from '@/growthTime';

interface QuickAddValues {
  businessName: string;
  contactPhone: string;
  contactEmail: string;
  pageUrl: string;
  source: ProspectSource;
  note: string;
}

const initialValues: QuickAddValues = {
  businessName: '',
  contactPhone: '',
  contactEmail: '',
  pageUrl: '',
  source: 'manual_entry',
  note: '',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The quick add could not be completed.';
}

function trimmed(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}



function validate(values: QuickAddValues): string | null {
  if (!values.businessName.trim()) return 'Business name is required.';
  const hasChannel = [values.contactPhone, values.contactEmail, values.pageUrl]
    .some((value) => Boolean(value.trim()));
  if (!hasChannel) return 'At least one of phone, email, or page URL is required.';
  if (values.contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(values.contactEmail.trim())) {
    return 'Enter a valid contact email address.';
  }
  return null;
}

export function QuickAddPage() {
  const { reportApiError } = useGrowthAuth();
  const canManageFollowups = usePermission('growth_os.followups.manage');
  const [values, setValues] = useState<QuickAddValues>(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ProspectDuplicateMatch[]>([]);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ProspectListItem | null>(null);
  const [scheduleDueAt, setScheduleDueAt] = useState(() =>
    toBusinessDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
  const [scheduleAction, setScheduleAction] = useState('Call');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);

  function update(field: keyof Pick<QuickAddValues, 'businessName' | 'contactPhone' | 'contactEmail' | 'pageUrl' | 'note'>, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setValidationError(null);
    setError(null);
    setDuplicates([]);
    setDuplicateNotice(null);
    setConflictId(null);
    setConflictMessage(null);
  }

  async function checkDuplicates(): Promise<ProspectDuplicateMatch[] | null> {
    const payload = {
      contactPhone: trimmed(values.contactPhone),
      contactEmail: trimmed(values.contactEmail),
      pageUrl: trimmed(values.pageUrl),
    };
    if (!payload.contactPhone && !payload.contactEmail && !payload.pageUrl) return [];
    try {
      const result = await growthApi.checkProspectDuplicates(payload);
      setDuplicates(result.matches);
      setDuplicateNotice(null);
      return result.matches;
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return null;
      setDuplicates([]);
      setDuplicateNotice('The duplicate check could not run. Creating the prospect is still possible.');
      return [];
    }
  }

  function handleIdentityBlur() {
    const hasChannel = [values.contactPhone, values.contactEmail, values.pageUrl]
      .some((value) => Boolean(value.trim()));
    if (hasChannel) void checkDuplicates();
  }

  async function createProspect() {
    setSubmitting(true);
    setError(null);
    setConflictId(null);
    setConflictMessage(null);
    try {
      const saved = await growthApi.createProspect({
        businessName: values.businessName.trim(),
        contactPhone: trimmed(values.contactPhone),
        contactEmail: trimmed(values.contactEmail),
        pageUrl: trimmed(values.pageUrl),
        notes: trimmed(values.note),
        source: values.source,
      });
      setCreated(saved);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      const conflictingId = getConflictingProspectId(requestError);
      if (conflictingId) {
        setConflictId(conflictingId);
        setConflictMessage(errorMessage(requestError));
      } else {
        setError(errorMessage(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValidationError = validate(values);
    if (nextValidationError) {
      setValidationError(nextValidationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    const matches = await checkDuplicates();
    setSubmitting(false);
    if (matches === null) return;
    if (matches.length > 0) return;
    await createProspect();
  }

  async function scheduleFirstFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!created) return;
    const dueDate = fromBusinessDateTimeLocal(scheduleDueAt);
    if (!scheduleDueAt || Number.isNaN(dueDate.getTime())) {
      setScheduleError('Choose a valid due date and time.');
      return;
    }
    if (!scheduleAction.trim()) {
      setScheduleError('An action is required.');
      return;
    }
    setScheduling(true);
    setScheduleError(null);
    try {
      await workspaceApi.createFollowup({
        prospectId: created.id,
        dueAt: dueDate.toISOString(),
        action: scheduleAction.trim(),
        note: trimmed(scheduleNote) ?? null,
      });
      setScheduledAt(dueDate.toISOString());
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setScheduleError(errorMessage(requestError));
    } finally {
      setScheduling(false);
    }
  }

  if (created) {
    return (
      <main className="page-content" aria-labelledby="quick-add-success-title">
        <div className="page-heading">
          <div>
            <Link className="back-link" to="/prospects">
              <ArrowLeft aria-hidden="true" />
              <span>All prospects</span>
            </Link>
            <p className="eyebrow">Record captured</p>
            <h1 id="quick-add-success-title">Prospect created</h1>
          </div>
        </div>

        <section className="content-card" aria-labelledby="created-prospect-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Next step</p>
              <h3 id="created-prospect-title">{created.businessName}</h3>
            </div>
            <Zap aria-hidden="true" />
          </div>
          <p className="state-copy">
            Source recorded as{' '}
            <span className="source-code">{created.source.replace(/_/g, ' ')}</span>.
          </p>
          <div className="button-row">
            <Link className="primary-button" to={`/prospects/${encodeURIComponent(created.id)}`}>
              Open prospect record
            </Link>
          </div>
          {scheduleError ? <div className="inline-state error-state" role="alert"><p>{scheduleError}</p></div> : null}
          {!canManageFollowups ? (
            <p className="state-copy">Prospect created. Your role cannot schedule follow-ups.</p>
          ) : scheduledAt ? (
            <p className="state-copy">First follow-up scheduled. Review it on the prospect record at any time.</p>
          ) : (
            <form className="action-form" onSubmit={scheduleFirstFollowup}>
              <div className="section-heading compact-heading">
                <div>
                  <p className="eyebrow">Stay on schedule</p>
                  <h4>Schedule first follow-up</h4>
                </div>
                <CalendarPlus aria-hidden="true" />
              </div>
              <label htmlFor="quick-schedule-due">
                Due date *
                <input
                  id="quick-schedule-due"
                  type="datetime-local"
                  value={scheduleDueAt}
                  onChange={(event) => setScheduleDueAt(event.target.value)}
                  required
                />
              </label>
              <label htmlFor="quick-schedule-action">
                Action *
                <input
                  id="quick-schedule-action"
                  value={scheduleAction}
                  onChange={(event) => setScheduleAction(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <label htmlFor="quick-schedule-note">
                Note
                <textarea
                  id="quick-schedule-note"
                  value={scheduleNote}
                  onChange={(event) => setScheduleNote(event.target.value)}
                  rows={2}
                  maxLength={2000}
                />
              </label>
              <button className="primary-button" type="submit" disabled={scheduling}>
                {scheduling ? 'Scheduling' : 'Schedule follow-up'}
              </button>
            </form>
          )}
          <button className="secondary-button" type="button" onClick={() => {
            // Clear the whole success/schedule block: a carried-over
            // `scheduledAt` would falsely confirm a follow-up the next
            // prospect never received.
            setCreated(null);
            setValues(initialValues);
            setScheduledAt(null);
            setScheduleError(null);
            setScheduleDueAt(toBusinessDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
            setScheduleAction('Call');
            setScheduleNote('');
          }}>
            Add another prospect
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-content" aria-labelledby="quick-add-title">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/prospects">
            <ArrowLeft aria-hidden="true" />
            <span>All prospects</span>
          </Link>
          <p className="eyebrow">Fastest capture path</p>
          <h1 id="quick-add-title">Quick add</h1>
          <p className="page-lede">Name, one way to reach them, and where they came from. Everything else can follow on the prospect record.</p>
        </div>
      </div>

      {error ? <div className="inline-state error-state" role="alert"><p>{error}</p></div> : null}
      {validationError ? <div className="inline-state error-state" role="alert"><p>{validationError}</p></div> : null}
      {conflictId ? (
        <section className="duplicate-warning" aria-labelledby="quick-conflict-title">
          <strong id="quick-conflict-title">This identity already exists</strong>
          <p>{conflictMessage || 'A prospect record with the same contact identity was found.'}</p>
          <p>
            <Link className="table-link" to={`/prospects/${encodeURIComponent(conflictId)}`}>
              Open the conflicting prospect
            </Link>
          </p>
          <button className="secondary-button" type="button" onClick={() => { setConflictId(null); setConflictMessage(null); }}>
            Update details
          </button>
        </section>
      ) : null}
      {duplicates.length > 0 || duplicateNotice ? (
        <section className="duplicate-warning" aria-labelledby="quick-duplicate-title">
          <strong id="quick-duplicate-title">{duplicateNotice ? 'Duplicate check unavailable' : 'Possible duplicate prospect'}</strong>
          {duplicateNotice ? <p>{duplicateNotice}</p> : null}
          {duplicates.length > 0 ? <p>Creation is blocked while the identity matches an existing record. Review it or update the details before trying again.</p> : null}
          <ul>
            {duplicates.map((duplicate) => (
              <li key={duplicate.prospectId}>
                <Link className="table-link" to={`/prospects/${encodeURIComponent(duplicate.prospectId)}`}>
                  {duplicate.businessName}
                </Link>
                <span>{duplicate.matchedFields.join(', ')}</span>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => { setDuplicates([]); setDuplicateNotice(null); }}>
              Update details
            </button>
          </div>
        </section>
      ) : null}

      <form className="prospect-form" onSubmit={handleSubmit} noValidate>
        <section className="content-card form-section" aria-labelledby="quick-identity-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Required context</p>
              <h3 id="quick-identity-title">Who and how to reach</h3>
            </div>
          </div>
          <div className="form-grid">
            <label htmlFor="quick-business-name">
              Business name *
              <input
                id="quick-business-name"
                value={values.businessName}
                onChange={(event) => update('businessName', event.target.value)}
                required
              />
            </label>
            <label htmlFor="quick-contact-phone">
              Contact phone
              <input
                id="quick-contact-phone"
                type="tel"
                value={values.contactPhone}
                onChange={(event) => update('contactPhone', event.target.value)}
                onBlur={handleIdentityBlur}
                placeholder="01XXXXXXXXX"
              />
            </label>
            <label htmlFor="quick-contact-email">
              Contact email
              <input
                id="quick-contact-email"
                type="email"
                value={values.contactEmail}
                onChange={(event) => update('contactEmail', event.target.value)}
                onBlur={handleIdentityBlur}
                placeholder="name@example.com"
              />
            </label>
            <label htmlFor="quick-page-url">
              Page URL
              <input
                id="quick-page-url"
                type="url"
                value={values.pageUrl}
                onChange={(event) => update('pageUrl', event.target.value)}
                onBlur={handleIdentityBlur}
                placeholder="https://..."
              />
            </label>
          </div>
          <p className="field-hint">At least one phone, email, or page URL is required.</p>
        </section>

        <section className="content-card form-section" aria-labelledby="quick-source-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Attribution</p>
              <h3 id="quick-source-title">Source and note</h3>
            </div>
          </div>
          <div className="form-grid">
            <label htmlFor="quick-source">
              Source *
              <select
                id="quick-source"
                value={values.source}
                onChange={(event) => setValues((current) => ({ ...current, source: event.target.value as ProspectSource }))}
              >
                {PROSPECT_SOURCES.map((source) => (
                  <option key={source} value={source}>{source.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
          </div>
          <label htmlFor="quick-note">
            Note
            <textarea
              id="quick-note"
              value={values.note}
              onChange={(event) => update('note', event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What should the next teammate know?"
            />
          </label>
        </section>

        <div className="form-footer">
          <Link className="secondary-button" to="/prospects/new">Use the full form</Link>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Zap aria-hidden="true" />
            <span>{submitting ? 'Saving' : 'Create prospect'}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
