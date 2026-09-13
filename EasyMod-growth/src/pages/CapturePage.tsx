import { useState, type FormEvent } from 'react';
import { ArrowLeft, ClipboardCheck, Puzzle } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getConflictingProspectId,
  growthApi,
  type ProspectDuplicateMatch,
  type ProspectListItem,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { MessageState } from '@/components/states';

const CAPTURE_STORAGE_KEY = 'growth-os.capture-payload.v1';

interface CapturePayload {
  businessName?: string;
  pageUrl?: string;
  sourceWebsite?: string;
  selectedText?: string;
  contactPhone?: string;
  contactEmail?: string;
  note?: string;
}

interface ReviewValues {
  businessName: string;
  contactPhone: string;
  contactEmail: string;
  pageUrl: string;
  note: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseStoredPayload(): CapturePayload | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CAPTURE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const payload: CapturePayload = {
      businessName: readString(record.businessName),
      pageUrl: readString(record.pageUrl),
      sourceWebsite: readString(record.sourceWebsite),
      selectedText: readString(record.selectedText),
      contactPhone: readString(record.contactPhone),
      contactEmail: readString(record.contactEmail),
      note: readString(record.note),
    };
    const hasContent = Object.values(payload).some((value) => value !== undefined);
    return hasContent ? payload : null;
  } catch {
    return null;
  }
}

function valuesFromPayload(payload: CapturePayload): ReviewValues {
  return {
    businessName: payload.businessName ?? '',
    contactPhone: payload.contactPhone ?? '',
    contactEmail: payload.contactEmail ?? '',
    pageUrl: payload.pageUrl ?? '',
    note: payload.note ?? '',
  };
}

function trimmed(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function composeNotes(payload: CapturePayload, note: string) {
  const lines: string[] = [];
  if (note.trim()) lines.push(note.trim());
  if (payload.selectedText) {
    const text = payload.selectedText.length > 1500 ? `${payload.selectedText.slice(0, 1500)}…` : payload.selectedText;
    lines.push(`Captured text: ${text}`);
  }
  return lines.join('\n') || undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The captured prospect could not be saved.';
}

function validate(values: ReviewValues): string | null {
  if (!values.businessName.trim()) return 'Business name is required.';
  const hasChannel = [values.contactPhone, values.contactEmail, values.pageUrl]
    .some((value) => Boolean(value.trim()));
  if (!hasChannel) return 'At least one of phone, email, or page URL is required.';
  if (values.contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(values.contactEmail.trim())) {
    return 'Enter a valid contact email address.';
  }
  return null;
}

export function CapturePage() {
  const { reportApiError } = useGrowthAuth();
  const [payload] = useState<CapturePayload | null>(() => parseStoredPayload());
  const [values, setValues] = useState<ReviewValues>(() => valuesFromPayload(payload ?? {}));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ProspectDuplicateMatch[]>([]);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ProspectListItem | null>(null);

  function update(field: keyof ReviewValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setValidationError(null);
    setError(null);
    setDuplicates([]);
    setConflictId(null);
    setConflictMessage(null);
  }

  async function checkDuplicates(): Promise<ProspectDuplicateMatch[] | null> {
    const identity = {
      contactPhone: trimmed(values.contactPhone),
      contactEmail: trimmed(values.contactEmail),
      pageUrl: trimmed(values.pageUrl),
    };
    if (!identity.contactPhone && !identity.contactEmail && !identity.pageUrl) return [];
    try {
      const result = await growthApi.checkProspectDuplicates(identity);
      setDuplicates(result.matches);
      return result.matches;
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return null;
      setDuplicates([]);
      return [];
    }
  }

  async function createProspect() {
    if (!payload) return;
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
        notes: composeNotes(payload, values.note),
        source: 'browser_extension',
        sourceDetail: payload.sourceWebsite,
      });
      window.sessionStorage.removeItem(CAPTURE_STORAGE_KEY);
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

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValidationError = validate(values);
    if (nextValidationError) {
      setValidationError(nextValidationError);
      return;
    }
    setSubmitting(true);
    const matches = await checkDuplicates();
    setSubmitting(false);
    if (matches === null) {
      return;
    }
    if (matches.length > 0) {
      return;
    }
    await createProspect();
  }

  if (created) {
    return (
      <main className="page-content" aria-labelledby="capture-created-title">
        <div className="page-heading">
          <div>
            <Link className="back-link" to="/prospects">
              <ArrowLeft aria-hidden="true" />
              <span>All prospects</span>
            </Link>
            <p className="eyebrow">Capture complete</p>
            <h1 id="capture-created-title">Captured prospect saved</h1>
            <p className="page-lede">The stored capture was cleared and the record now lives in the ledger with source attribution preserved.</p>
          </div>
        </div>
        <section className="content-card" aria-labelledby="capture-created-card-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Prospect record</p>
              <h3 id="capture-created-card-title">{created.businessName}</h3>
            </div>
            <ClipboardCheck aria-hidden="true" />
          </div>
          <dl className="detail-facts">
            <div><dt>Source</dt><dd><span className="source-code">browser extension</span></dd></div>
            <div><dt>Captured from</dt><dd>{payload?.sourceWebsite || 'Not recorded'}</dd></div>
          </dl>
          <div className="button-row">
            <Link className="primary-button" to={`/prospects/${encodeURIComponent(created.id)}`}>Open prospect record</Link>
          </div>
        </section>
      </main>
    );
  }

  if (!payload) {
    return (
      <MessageState eyebrow="Capture" title="No page capture found">
        <p>
          This page receives data from the EasyModerator Growth browser extension. While on a business page,
          select the listing details with the extension&rsquo;s capture action, and the extension will open
          this page with a pre-filled review form.
        </p>
        <p className="field-hint">
          No record has been created yet — review the pre-filled data here and confirm explicitly before anything is
          written to the ledger.
        </p>
        <Link className="secondary-button" to="/prospects">Go to the prospect ledger</Link>
      </MessageState>
    );
  }

  return (
    <main className="page-content" aria-labelledby="capture-review-title">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/prospects">
            <ArrowLeft aria-hidden="true" />
            <span>All prospects</span>
          </Link>
          <p className="eyebrow">Extension hand-off</p>
          <h1 id="capture-review-title">Review captured prospect</h1>
          <p className="page-lede">Everything below is editable until you confirm. Nothing is saved until you create the record.</p>
        </div>
      </div>

      {error ? <div className="inline-state error-state" role="alert"><p>{error}</p></div> : null}
      {validationError ? <div className="inline-state error-state" role="alert"><p>{validationError}</p></div> : null}
      {conflictId ? (
        <section className="duplicate-warning" aria-labelledby="capture-conflict-title">
          <strong id="capture-conflict-title">This identity already exists</strong>
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

      <form className="prospect-form" onSubmit={handleConfirm} noValidate>
        <section className="content-card form-section" aria-labelledby="capture-source-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Attribution locked</p>
              <h3 id="capture-source-title">Captured context</h3>
            </div>
            <Puzzle aria-hidden="true" />
          </div>
          <dl className="detail-facts">
            <div><dt>Source</dt><dd><span className="source-code">browser extension</span></dd></div>
            <div><dt>Captured from</dt><dd>{payload.sourceWebsite || 'Not recorded'}</dd></div>
            <div><dt>Page URL</dt><dd>{values.pageUrl || 'Not recorded'}</dd></div>
          </dl>
          {payload.selectedText ? <blockquote className="state-copy">{payload.selectedText}</blockquote> : null}
        </section>

        <section className="content-card form-section" aria-labelledby="capture-identity-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Check before saving</p>
              <h3 id="capture-identity-title">Editable preview</h3>
            </div>
          </div>
          <div className="form-grid">
            <label htmlFor="capture-business-name">
              Business name *
              <input
                id="capture-business-name"
                value={values.businessName}
                onChange={(event) => update('businessName', event.target.value)}
                required
              />
            </label>
            <label htmlFor="capture-contact-phone">
              Contact phone
              <input
                id="capture-contact-phone"
                type="tel"
                value={values.contactPhone}
                onChange={(event) => update('contactPhone', event.target.value)}
                onBlur={() => { void checkDuplicates(); }}
              />
            </label>
            <label htmlFor="capture-contact-email">
              Contact email
              <input
                id="capture-contact-email"
                type="email"
                value={values.contactEmail}
                onChange={(event) => update('contactEmail', event.target.value)}
                onBlur={() => { void checkDuplicates(); }}
              />
            </label>
            <label htmlFor="capture-page-url">
              Page URL
              <input
                id="capture-page-url"
                type="url"
                value={values.pageUrl}
                onChange={(event) => update('pageUrl', event.target.value)}
                onBlur={() => { void checkDuplicates(); }}
              />
            </label>
          </div>
          <label htmlFor="capture-note">
            Note
            <textarea
              id="capture-note"
              value={values.note}
              onChange={(event) => update('note', event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </label>
        </section>

        {duplicates.length > 0 ? (
          <section className="duplicate-warning" aria-labelledby="capture-duplicate-title">
            <strong id="capture-duplicate-title">Possible duplicate prospect</strong>
            <p>Review the existing record. Continue only if this capture is a genuinely separate prospect.</p>
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
              <button className="primary-button" type="button" onClick={() => { setDuplicates([]); void createProspect(); }}>
                Create anyway
              </button>
              <button className="secondary-button" type="button" onClick={() => setDuplicates([])}>
                Update details
              </button>
            </div>
          </section>
        ) : null}

        <div className="form-footer">
          <Link className="secondary-button" to="/prospects">Cancel</Link>
          <button className="primary-button" type="submit" disabled={submitting}>
            <ClipboardCheck aria-hidden="true" />
            <span>{submitting ? 'Checking and creating' : 'Create prospect'}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
