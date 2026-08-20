import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import {
  getConflictingProspectId,
  growthApi,
  PROSPECT_SOURCES,
  type Prospect,
  type ProspectDuplicateMatch,
  type ProspectFormPayload,
  type ProspectSource,
} from '@/api/client';

interface ProspectFormValues {
  businessName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  pageUrl: string;
  niche: string;
  notes: string;
  source: ProspectSource | '';
  sourceDetail: string;
}

const emptyValues: ProspectFormValues = {
  businessName: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  pageUrl: '',
  niche: '',
  notes: '',
  source: 'manual_entry',
  sourceDetail: '',
};

const sensitiveFields: Array<keyof Pick<ProspectFormValues, 'contactName' | 'contactPhone' | 'contactEmail' | 'pageUrl'>> = [
  'contactName',
  'contactPhone',
  'contactEmail',
  'pageUrl',
];

function sourceLabel(source: string) {
  return source.replace(/_/g, ' ');
}

function trimmed(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function stringValue(value: string | null | undefined) {
  return value ?? '';
}

function valuesFromProspect(prospect: Prospect): ProspectFormValues {
  return {
    businessName: prospect.businessName,
    contactName: stringValue(prospect.contactName),
    contactPhone: stringValue(prospect.contactPhone),
    contactEmail: stringValue(prospect.contactEmail),
    pageUrl: stringValue(prospect.pageUrl),
    niche: stringValue(prospect.niche),
    notes: stringValue(prospect.notes),
    source: prospect.source,
    sourceDetail: stringValue(prospect.sourceDetail),
  };
}

function toPayload(values: ProspectFormValues, redacted: boolean, editing: boolean): ProspectFormPayload {
  const optionalValue = (value: string) => {
    const normalized = value.trim();
    return editing ? (normalized || null) : (normalized || undefined);
  };
  const payload: ProspectFormPayload = {
    businessName: values.businessName.trim(),
    niche: optionalValue(values.niche),
    notes: optionalValue(values.notes),
    source: values.source as ProspectSource,
    sourceDetail: optionalValue(values.sourceDetail),
  };

  if (!redacted) {
    payload.contactName = optionalValue(values.contactName);
    payload.contactPhone = optionalValue(values.contactPhone);
    payload.contactEmail = optionalValue(values.contactEmail);
    payload.pageUrl = optionalValue(values.pageUrl);
  }

  return payload;
}

function duplicatePayload(values: ProspectFormValues, prospectId: string | undefined) {
  return {
    contactPhone: trimmed(values.contactPhone),
    contactEmail: trimmed(values.contactEmail),
    pageUrl: trimmed(values.pageUrl),
    excludeId: prospectId,
  };
}

function validate(values: ProspectFormValues, redacted: boolean) {
  if (!values.businessName.trim()) return 'Business name is required.';
  if (!values.source) return 'Source is required.';
  if (redacted) return null;

  const hasChannel = [values.contactPhone, values.contactEmail, values.pageUrl]
    .some((value) => Boolean(value.trim()));
  if (!hasChannel) return 'At least one of phone, email, or page URL is required.';

  if (values.contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(values.contactEmail.trim())) {
    return 'Enter a valid contact email address.';
  }

  return null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hidden,
  required = false,
}: {
  id: keyof ProspectFormValues;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  hidden?: boolean;
  required?: boolean;
}) {
  return (
    <label htmlFor={hidden ? undefined : id}>
      {label}{required ? ' *' : ''}
      {hidden ? (
        <span className="redacted-input" aria-label={`${label}: Hidden for your role`}>Hidden for your role</span>
      ) : (
        <input id={id} name={id} type={type} value={value} onChange={onChange} placeholder={placeholder} required={required} />
      )}
    </label>
  );
}

export function ProspectFormPage() {
  const { prospectId } = useParams<{ prospectId: string }>();
  const navigate = useNavigate();
  const { reportApiError } = useGrowthAuth();
  const editing = Boolean(prospectId);
  const [values, setValues] = useState<ProspectFormValues>(emptyValues);
  const [redacted, setRedacted] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ProspectDuplicateMatch[]>([]);
  const [duplicateConflictId, setDuplicateConflictId] = useState<string | null>(null);
  const [duplicateConflictMessage, setDuplicateConflictMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!prospectId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    growthApi.getProspect(prospectId)
      .then((prospect) => {
        if (!active) return;
        setValues(valuesFromProspect(prospect));
        setRedacted(prospect.redacted === true);
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setError(errorMessage(requestError, 'Unable to load this prospect for editing.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [prospectId]);

  function updateValue(field: keyof ProspectFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setDuplicates([]);
    setDuplicateConflictId(null);
    setDuplicateConflictMessage(null);
    setValidationError(null);
    setError(null);
  }

  function handleInput(field: keyof ProspectFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => updateValue(field, event.target.value);
  }

  function handleTextArea(field: keyof ProspectFormValues) {
    return (event: ChangeEvent<HTMLTextAreaElement>) => updateValue(field, event.target.value);
  }

  async function save(skipDuplicateCheck = false) {
    const nextValidationError = validate(values, redacted);
    if (nextValidationError) {
      setValidationError(nextValidationError);
      return;
    }

    const payload = toPayload(values, redacted, editing);
    setSubmitting(true);
    setError(null);
    setValidationError(null);
    setDuplicateConflictId(null);
    setDuplicateConflictMessage(null);
    try {
      if (!skipDuplicateCheck) {
        const duplicateResult = await growthApi.checkProspectDuplicates(duplicatePayload(values, prospectId));
        if (duplicateResult.matches.length > 0) {
          setDuplicates(duplicateResult.matches);
          return;
        }
      }

      const saved = editing && prospectId
        ? await growthApi.updateProspect(prospectId, payload)
        : await growthApi.createProspect(payload);
      navigate(`/prospects/${encodeURIComponent(saved.id)}`, { replace: true });
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      const conflictId = getConflictingProspectId(requestError);
      if (conflictId) {
        setDuplicateConflictId(conflictId);
        setDuplicateConflictMessage(errorMessage(requestError, 'A duplicate prospect already exists.'));
      } else {
        setError(errorMessage(requestError, 'Unable to save this prospect.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  if (loading) {
    return (
      <main className="page-content" aria-label="Loading prospect form">
        <div className="content-card detail-loading">
          <div className="loading-mark" aria-hidden="true" />
          <p>Loading prospect form</p>
        </div>
      </main>
    );
  }

  if (error && editing && values.businessName === '') {
    return (
      <main className="page-content" aria-labelledby="form-error-title">
        <div className="inline-state error-state" role="alert">
          <h2 id="form-error-title">Prospect form unavailable</h2>
          <p>{error}</p>
          <Link className="secondary-button" to="/prospects">Back to prospects</Link>
        </div>
      </main>
    );
  }

  const hasDuplicateWarning = duplicates.length > 0 || Boolean(duplicateConflictId);

  return (
    <main className="page-content" aria-labelledby="prospect-form-title">
      <div className="page-heading">
        <div>
          <Link className="back-link" to={editing && prospectId ? `/prospects/${encodeURIComponent(prospectId)}` : '/prospects'}>
            <ArrowLeft aria-hidden="true" />
            <span>{editing ? 'Back to prospect' : 'All prospects'}</span>
          </Link>
          <p className="eyebrow">{editing ? 'Update record' : 'New record'}</p>
          <h2 id="prospect-form-title">{editing ? 'Edit prospect' : 'Capture a prospect'}</h2>
          <p className="page-lede">Keep the source record focused on the next useful conversation. Server validation remains authoritative.</p>
        </div>
      </div>

      {error ? <div className="inline-state error-state" role="alert"><p>{error}</p></div> : null}
      {validationError ? <div className="inline-state error-state" role="alert"><p>{validationError}</p></div> : null}
      {hasDuplicateWarning ? (
        <section className="duplicate-warning" aria-labelledby="duplicate-warning-title">
          <strong id="duplicate-warning-title">Possible duplicate prospect</strong>
          <p>{duplicateConflictMessage || 'Review the existing record before saving this prospect.'}</p>
          {duplicates.length > 0 ? (
            <ul>
              {duplicates.map((duplicate) => (
                <li key={duplicate.prospectId}>
                  <Link className="table-link" to={`/prospects/${encodeURIComponent(duplicate.prospectId)}`} target="_blank" rel="noreferrer">
                    {duplicate.businessName}
                  </Link>
                  <span>{duplicate.matchedFields.join(', ')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {duplicateConflictId && !duplicates.some((duplicate) => duplicate.prospectId === duplicateConflictId) ? (
            <p>
              <Link className="table-link" to={`/prospects/${encodeURIComponent(duplicateConflictId)}`} target="_blank" rel="noreferrer">
                Open the conflicting prospect
              </Link>
            </p>
          ) : null}
          <div className="button-row">
            <button className="primary-button" type="button" disabled={submitting} onClick={() => void save(true)}>
              {submitting ? 'Saving' : 'Continue with save'}
            </button>
            <button className="secondary-button" type="button" onClick={() => {
              setDuplicates([]);
              setDuplicateConflictId(null);
              setDuplicateConflictMessage(null);
            }}>
              Review form
            </button>
          </div>
        </section>
      ) : null}

      <form className="prospect-form" onSubmit={handleSubmit} noValidate>
        <section className="content-card form-section" aria-labelledby="identity-section-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Required context</p>
              <h3 id="identity-section-title">Business identity</h3>
            </div>
          </div>
          <div className="form-grid">
            <Field id="businessName" label="Business name" value={values.businessName} onChange={handleInput('businessName')} placeholder="Example: Rahim Fashion" required />
            <Field id="niche" label="Niche" value={values.niche} onChange={handleInput('niche')} placeholder="Example: apparel" />
          </div>
        </section>

        <section className="content-card form-section" aria-labelledby="contact-section-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Reachability</p>
              <h3 id="contact-section-title">Contact channels</h3>
            </div>
          </div>
          <p className="field-hint">At least one phone, email, or page URL is required.</p>
          <div className="form-grid">
            <Field id="contactName" label="Contact name" value={values.contactName} onChange={handleInput('contactName')} hidden={redacted && sensitiveFields.includes('contactName')} />
            <Field id="contactPhone" label="Contact phone" value={values.contactPhone} onChange={handleInput('contactPhone')} type="tel" placeholder="01XXXXXXXXX" hidden={redacted && sensitiveFields.includes('contactPhone')} />
            <Field id="contactEmail" label="Contact email" value={values.contactEmail} onChange={handleInput('contactEmail')} type="email" placeholder="name@example.com" hidden={redacted && sensitiveFields.includes('contactEmail')} />
            <Field id="pageUrl" label="Page URL" value={values.pageUrl} onChange={handleInput('pageUrl')} type="url" placeholder="https://..." hidden={redacted && sensitiveFields.includes('pageUrl')} />
          </div>
        </section>

        <section className="content-card form-section" aria-labelledby="source-section-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Attribution</p>
              <h3 id="source-section-title">Acquisition source</h3>
            </div>
          </div>
          <div className="form-grid">
            <label htmlFor="source">
              Source *
              <select id="source" name="source" value={values.source} onChange={(event) => updateValue('source', event.target.value)} required>
                <option value="">Select a source</option>
                {PROSPECT_SOURCES.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
              </select>
            </label>
            <label htmlFor="sourceDetail">
              Source detail
              <input id="sourceDetail" name="sourceDetail" value={values.sourceDetail} onChange={handleInput('sourceDetail')} placeholder="Campaign, partner, or context" />
            </label>
          </div>
        </section>

        <section className="content-card form-section" aria-labelledby="notes-section-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Working context</p>
              <h3 id="notes-section-title">Notes</h3>
            </div>
          </div>
          <label htmlFor="notes">
            Prospect notes
            <textarea id="notes" name="notes" value={values.notes} onChange={handleTextArea('notes')} rows={5} placeholder="What should the next teammate know?" />
          </label>
        </section>

        <div className="form-footer">
          <Link className="secondary-button" to={editing && prospectId ? `/prospects/${encodeURIComponent(prospectId)}` : '/prospects'}>Cancel</Link>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Save aria-hidden="true" />
            <span>{submitting ? 'Checking and saving' : editing ? 'Save changes' : 'Create prospect'}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
