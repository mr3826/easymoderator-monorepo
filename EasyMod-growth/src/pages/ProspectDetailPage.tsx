import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, GitMerge, Link2, RefreshCw, UserRound, Workflow } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import {
  ApiError,
  growthApi,
  PROSPECT_ALLOWED_TRANSITIONS,
  type Prospect,
  type ProspectLinkageSuggestion,
  type ProspectStatus,
} from '@/api/client';
import { usePermission } from '@/auth/usePermission';

const REDACTED_CONTACT_FIELDS = new Set(['contactName', 'contactPhone', 'contactEmail', 'pageUrl']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value.trim());
}

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatValue(value: string | null | undefined, hidden = false) {
  if (hidden) return 'Hidden for your role';
  if (!value) return 'Not provided';
  return value;
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function formatAuditValue(value: string | null) {
  return value || 'Not provided';
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function Field({
  label,
  value,
  field,
  redacted,
}: {
  label: string;
  value: string | null | undefined;
  field: string;
  redacted?: boolean;
}) {
  const hidden = redacted && REDACTED_CONTACT_FIELDS.has(field);
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd className={hidden ? 'redacted-value' : undefined}>{formatValue(value, hidden)}</dd>
    </div>
  );
}

function LoadingDetail() {
  return (
    <main className="page-content" aria-label="Loading prospect">
      <div className="content-card detail-loading">
        <div className="loading-mark" aria-hidden="true" />
        <p>Loading prospect details</p>
      </div>
    </main>
  );
}

function TimelineEvent({ event }: { event: Prospect['timeline'][number] }) {
  const metadataEntries = Object.entries(event.metadata || {});
  return (
    <li className="timeline-item">
      <span className="timeline-marker" aria-hidden="true" />
      <div>
        <div className="timeline-header">
          <strong>{codeLabel(event.eventType)}</strong>
          <time dateTime={event.createdAt}>{formatDate(event.createdAt, true)}</time>
        </div>
        <dl className="timeline-details">
          <div><dt>Actor</dt><dd>{formatValue(event.actorUserId)}</dd></div>
          {event.fromValue || event.toValue ? (
            <>
              <div><dt>From</dt><dd>{formatAuditValue(event.fromValue)}</dd></div>
              <div><dt>To</dt><dd>{formatAuditValue(event.toValue)}</dd></div>
            </>
          ) : null}
          {event.reason ? <div><dt>Reason</dt><dd>{event.reason}</dd></div> : null}
          {event.changedFields.length > 0 ? <div><dt>Changed fields</dt><dd>{event.changedFields.join(', ')}</dd></div> : null}
          {metadataEntries.length > 0 ? <div><dt>Metadata</dt><dd>{JSON.stringify(event.metadata)}</dd></div> : null}
        </dl>
      </div>
    </li>
  );
}

export function ProspectDetailPage() {
  const { prospectId } = useParams<{ prospectId: string }>();
  const navigate = useNavigate();
  const { reportApiError } = useGrowthAuth();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [linkageSuggestions, setLinkageSuggestions] = useState<ProspectLinkageSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [nextStatus, setNextStatus] = useState<ProspectStatus>('new');
  const [statusReason, setStatusReason] = useState('');
  const [linkShopId, setLinkShopId] = useState('');
  const [linkUserId, setLinkUserId] = useState('');
  const [linkReason, setLinkReason] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [busyAction, setBusyAction] = useState<'assign' | 'status' | 'link' | 'merge' | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const canManage = usePermission('growth_os.prospects.manage_all');
  const canUpdate = usePermission(['growth_os.prospects.manage_all', 'growth_os.prospects.update_assigned']);

  useEffect(() => {
    let active = true;
    if (!prospectId) {
      setError('This prospect URL is missing an identifier.');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);
    setActionError(null);
    const suggestionsRequest = canManage
      ? growthApi.getProspectLinkageSuggestions(prospectId).catch((suggestionError: unknown) => {
        if (suggestionError instanceof ApiError && [401, 403, 503].includes(suggestionError.status)) {
          throw suggestionError;
        }
        return [];
      })
      : Promise.resolve([] as ProspectLinkageSuggestion[]);
    Promise.all([growthApi.getProspect(prospectId), suggestionsRequest])
      .then(([nextProspect, suggestions]) => {
        if (!active) return;
        setProspect(nextProspect);
        setLinkageSuggestions(suggestions);
        setOwnerUserId(nextProspect.ownerUserId ?? '');
        setAssignmentReason('');
        setNextStatus(nextProspect.status);
        setStatusReason('');
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setProspect(null);
        setError(messageFor(requestError, 'Unable to load this prospect.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canManage, prospectId, reloadToken, reportApiError]);

  async function loadTimelinePage(page: number) {
    if (!prospectId || !prospect?.timelinePagination) return;
    setTimelineLoading(true);
    setActionError(null);
    try {
      const nextProspect = await growthApi.getProspect(prospectId, {
        timelinePage: page,
        timelinePageSize: prospect.timelinePagination.pageSize,
      });
      setProspect(nextProspect);
    } catch (requestError: unknown) {
      if (!reportApiError(requestError)) setActionError(messageFor(requestError, 'Unable to load this timeline page.'));
    } finally {
      setTimelineLoading(false);
    }
  }

  async function handleAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospectId) return;
    if (!assignmentReason.trim()) {
      setActionError('A reason is required when changing the owner.');
      return;
    }
    if (ownerUserId.trim() && !isUuid(ownerUserId)) {
      setActionError('Owner user ID must be a valid UUID.');
      return;
    }
    setBusyAction('assign');
    setActionError(null);
    try {
      await growthApi.assignProspect(prospectId, {
        ownerUserId: ownerUserId.trim() || null,
        reason: assignmentReason.trim(),
      });
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setActionError(messageFor(requestError, 'Unable to update the prospect owner.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStatusTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospectId || nextStatus === prospect?.status) return;
    if ((nextStatus === 'disqualified' || (prospect?.status === 'disqualified' && nextStatus === 'qualifying'))
      && !statusReason.trim()) {
      setActionError('A reason is required for this lifecycle transition.');
      return;
    }
    setBusyAction('status');
    setActionError(null);
    try {
      await growthApi.transitionProspectStatus(prospectId, {
        status: nextStatus,
        reason: statusReason.trim() || undefined,
      });
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setActionError(messageFor(requestError, 'Unable to transition this prospect.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLink(shopId?: string, userId?: string, unlink = false) {
    if (!prospectId) return;
    const nextShopId = shopId?.trim() || null;
    const nextUserId = userId?.trim() || null;
    if (!nextShopId && !nextUserId && !unlink) {
      setActionError('Enter a shop ID or user ID to link this prospect.');
      return;
    }
    if (nextShopId && !isUuid(nextShopId)) {
      setActionError('Shop ID must be a valid UUID.');
      return;
    }
    if (nextUserId && !isUuid(nextUserId)) {
      setActionError('User ID must be a valid UUID.');
      return;
    }
    if (!linkReason.trim()) {
      setActionError('A reason is required when changing linkage.');
      return;
    }
    setBusyAction('link');
    setActionError(null);
    try {
      await growthApi.linkProspect(prospectId, {
        ...(unlink ? { shopId: null, userId: null } : {}),
        ...(!unlink && nextShopId ? { shopId: nextShopId } : {}),
        ...(!unlink && nextUserId ? { userId: nextUserId } : {}),
        reason: linkReason.trim(),
      });
      setLinkShopId('');
      setLinkUserId('');
      setLinkReason('');
      setReloadToken((current) => current + 1);
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setActionError(messageFor(requestError, 'Unable to update prospect linkage.'));
    } finally {
      setBusyAction(null);
    }
  }

  function handleManualLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleLink(linkShopId, linkUserId);
  }

  async function handleMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prospectId) return;
    const targetId = mergeTargetId.trim();
    if (!targetId || targetId === prospectId) {
      setActionError('Enter a different target prospect ID.');
      return;
    }
    if (!isUuid(targetId)) {
      setActionError('Target prospect ID must be a valid UUID.');
      return;
    }
    if (!mergeReason.trim()) {
      setActionError('A reason is required when merging prospects.');
      return;
    }
    setBusyAction('merge');
    setActionError(null);
    try {
      const result = await growthApi.mergeProspect(prospectId, {
        targetProspectId: targetId,
        reason: mergeReason.trim(),
      });
      navigate(`/prospects/${encodeURIComponent(result.targetProspect.id)}`, { replace: true });
    } catch (requestError: unknown) {
      if (reportApiError(requestError)) return;
      setActionError(messageFor(requestError, 'Unable to merge this prospect.'));
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) return <LoadingDetail />;

  if (error || !prospect || !prospectId) {
    return (
      <main className="page-content" aria-labelledby="prospect-error-title">
        <div className="inline-state error-state" role="alert">
          <h2 id="prospect-error-title">Prospect unavailable</h2>
          <p>{error || 'This prospect could not be found.'}</p>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>Try again</button>
            <Link className="secondary-button" to="/prospects">Back to prospects</Link>
          </div>
        </div>
      </main>
    );
  }

  const redacted = prospect.redacted === true;
  const isMerged = prospect.status === 'merged';
  const statusClass = `status-${prospect.status.replace(/_/g, '-')}`;
  const timeline = prospect.timeline ?? [];
  const allowedNextStatuses = PROSPECT_ALLOWED_TRANSITIONS[prospect.status];

  return (
    <main className="page-content detail-page" aria-labelledby="prospect-detail-title">
      <div className="page-heading detail-heading">
        <div>
          <Link className="back-link" to="/prospects">
            <ArrowLeft aria-hidden="true" />
            <span>All prospects</span>
          </Link>
          <p className="eyebrow">Prospect record</p>
          <h2 id="prospect-detail-title">{prospect.businessName}</h2>
          <div className="heading-meta">
            <span className={`status-badge ${statusClass}`}>{codeLabel(prospect.status)}</span>
            <span className={prospect.eligibleForNextPhase ? 'eligible-yes' : 'eligible-no'}>
              {prospect.eligibleForNextPhase ? 'Eligible for next phase' : 'Not eligible for next phase'}
            </span>
            <span>Updated {formatDate(prospect.updatedAt)}</span>
          </div>
        </div>
        <div className="button-row">
          {canUpdate && !isMerged ? <Link className="primary-button" to={`/prospects/${encodeURIComponent(prospect.id)}/edit`}>Edit prospect</Link> : null}
          <button className="icon-button" type="button" aria-label="Refresh prospect" title="Refresh prospect" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      {actionError ? <div className="inline-state error-state" role="alert"><strong>Action could not be completed.</strong><p>{actionError}</p></div> : null}

      <div className="detail-grid">
        <div className="detail-main-column">
          <section className="content-card" aria-labelledby="identity-details-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Identity and qualification</p>
                <h3 id="identity-details-title">Prospect details</h3>
              </div>
              <UserRound aria-hidden="true" />
            </div>
            <dl className="detail-fields">
              <Field label="Contact name" field="contactName" value={prospect.contactName} redacted={redacted} />
              <Field label="Contact phone" field="contactPhone" value={prospect.contactPhone} redacted={redacted} />
              <Field label="Contact email" field="contactEmail" value={prospect.contactEmail} redacted={redacted} />
              <Field label="Page URL" field="pageUrl" value={prospect.pageUrl} redacted={redacted} />
              <Field label="Niche" field="niche" value={prospect.niche} />
              <Field label="Source" field="source" value={codeLabel(prospect.source)} />
              <Field label="Source detail" field="sourceDetail" value={prospect.sourceDetail} />
              <Field label="Source reference" field="sourceReference" value={prospect.sourceReference} />
              <Field label="Source recorded" field="sourceRecordedAt" value={formatDate(prospect.sourceRecordedAt, true)} />
              <Field label="Notes" field="notes" value={prospect.notes} />
            </dl>
          </section>

          <section className="content-card" aria-labelledby="timeline-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Audited history</p>
                <h3 id="timeline-title">Timeline</h3>
              </div>
              <CheckCircle2 aria-hidden="true" />
            </div>
            {timeline.length === 0 ? (
              <div className="inline-state empty-state compact-state"><p>No activity has been recorded yet.</p></div>
            ) : (
              <ol className="timeline-list">
                {timeline.map((event) => <TimelineEvent key={event.id} event={event} />)}
              </ol>
            )}
            {prospect.timelinePagination && prospect.timelinePagination.totalPages > 1 ? (
              <div className="button-row timeline-pagination" aria-label="Timeline pagination">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={timelineLoading || prospect.timelinePagination.page <= 1}
                  onClick={() => void loadTimelinePage(prospect.timelinePagination.page - 1)}
                >
                  Previous
                </button>
                <span>Page {prospect.timelinePagination.page} of {prospect.timelinePagination.totalPages}</span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={timelineLoading || prospect.timelinePagination.page >= prospect.timelinePagination.totalPages}
                  onClick={() => void loadTimelinePage(prospect.timelinePagination.page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="detail-side-column">
          <section className="content-card" aria-labelledby="lifecycle-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Controlled workflow</p>
                <h3 id="lifecycle-title">Lifecycle</h3>
              </div>
              <Workflow aria-hidden="true" />
            </div>
            <dl className="side-details">
              <div><dt>Current status</dt><dd><span className={`status-badge ${statusClass}`}>{codeLabel(prospect.status)}</span></dd></div>
              <div><dt>Status changed</dt><dd>{formatDate(prospect.statusChangedAt, true)}</dd></div>
              <div><dt>Disqualified reason</dt><dd>{formatValue(prospect.disqualifiedReason)}</dd></div>
              <div><dt>Eligible for next phase</dt><dd className={prospect.eligibleForNextPhase ? 'eligible-yes' : 'eligible-no'}>{prospect.eligibleForNextPhase ? 'Yes' : 'No'}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(prospect.createdAt, true)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(prospect.updatedAt, true)}</dd></div>
            </dl>
            {canUpdate && !isMerged ? (
              <form className="action-form" onSubmit={handleStatusTransition}>
                <label htmlFor="next-status">
                   Move to status
                   <select id="next-status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as ProspectStatus)}>
                     <option value={prospect.status}>{codeLabel(prospect.status)} (current)</option>
                     {allowedNextStatuses.map((status) => <option key={status} value={status}>{codeLabel(status)}</option>)}
                   </select>
                 </label>
                 <label htmlFor="status-reason">
                   Reason <span className="field-hint-inline">required for disqualification and reopening</span>
                   <textarea id="status-reason" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} rows={3} maxLength={200} />
                </label>
                <button className="primary-button" type="submit" disabled={busyAction !== null || nextStatus === prospect.status}>
                  {busyAction === 'status' ? 'Updating' : 'Update lifecycle'}
                </button>
              </form>
            ) : null}
          </section>

          <section className="content-card" aria-labelledby="assignment-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Ownership</p>
                <h3 id="assignment-title">Assignment</h3>
              </div>
              <UserRound aria-hidden="true" />
            </div>
            <dl className="side-details">
              <div><dt>Owner user ID</dt><dd>{formatValue(prospect.ownerUserId)}</dd></div>
              <div><dt>Assigned at</dt><dd>{formatDate(prospect.assignedAt, true)}</dd></div>
              <div><dt>Assigned by</dt><dd>{formatValue(prospect.assignedBy)}</dd></div>
              <div><dt>Created by</dt><dd>{formatValue(prospect.createdBy)}</dd></div>
            </dl>
            {canManage && !isMerged ? (
              <form className="action-form" onSubmit={handleAssignment}>
                <label htmlFor="owner-user-id">
                  Owner user ID
                   <input id="owner-user-id" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="Leave blank to unassign" maxLength={36} />
                </label>
                <label htmlFor="assignment-reason">
                  Reason
                   <textarea id="assignment-reason" value={assignmentReason} onChange={(event) => setAssignmentReason(event.target.value)} rows={3} maxLength={200} required />
                </label>
                <button className="primary-button" type="submit" disabled={busyAction !== null}>
                  {busyAction === 'assign' ? 'Saving' : 'Save owner'}
                </button>
              </form>
            ) : <p className="state-copy">{isMerged ? 'Merged records cannot be changed.' : 'Only Growth Managers and Founders can change ownership.'}</p>}
          </section>

          <section className="content-card" aria-labelledby="linkage-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Conversion signal</p>
                <h3 id="linkage-title">Linkage</h3>
              </div>
              <Link2 aria-hidden="true" />
            </div>
            <dl className="side-details">
              <div><dt>Linked shop ID</dt><dd>{formatValue(prospect.linkedShopId)}</dd></div>
              <div><dt>Linked user ID</dt><dd>{formatValue(prospect.linkedUserId)}</dd></div>
              <div><dt>Linked at</dt><dd>{formatDate(prospect.linkedAt, true)}</dd></div>
              <div><dt>Merged into ID</dt><dd>{formatValue(prospect.mergedIntoId)}</dd></div>
              <div><dt>Merged at</dt><dd>{formatDate(prospect.mergedAt, true)}</dd></div>
            </dl>
            {linkageSuggestions.length > 0 ? (
              <>
                <h4 className="subsection-title">Linkage suggestions</h4>
                <ul className="suggestion-list">
                  {linkageSuggestions.map((suggestion) => (
                    <li key={`${suggestion.shopId}:${suggestion.userId ?? ''}`}>
                      <div>
                        <strong>{suggestion.shopName}</strong>
                        <span>Shop ID: {suggestion.shopId}</span>
                        {suggestion.matchedFields.length > 0 ? <small>Matched: {suggestion.matchedFields.join(', ')}</small> : null}
                      </div>
                      {canManage && !isMerged ? (
                        <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={() => void handleLink(suggestion.shopId)}>
                          {busyAction === 'link' ? 'Linking' : 'Link shop'}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : <div className="inline-state empty-state compact-state"><p>No likely linkage matches have been found.</p></div>}
            {canManage && !isMerged ? (
              <form className="action-form" onSubmit={handleManualLink}>
                <label htmlFor="shop-link-id">
                  Shop ID
                   <input id="shop-link-id" value={linkShopId} onChange={(event) => setLinkShopId(event.target.value)} maxLength={36} />
                </label>
                <label htmlFor="link-user-id">
                  User ID
                   <input id="link-user-id" value={linkUserId} onChange={(event) => setLinkUserId(event.target.value)} maxLength={36} />
                </label>
                <label htmlFor="link-reason">
                  Reason
                   <textarea id="link-reason" value={linkReason} onChange={(event) => setLinkReason(event.target.value)} rows={3} maxLength={200} required />
                </label>
                <button className="primary-button" type="submit" disabled={busyAction !== null}>
                  {busyAction === 'link' ? 'Linking' : 'Save linkage'}
                </button>
                {(prospect.linkedShopId || prospect.linkedUserId) ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleLink(undefined, undefined, true)}
                  >
                    {busyAction === 'link' ? 'Clearing' : 'Clear linkage'}
                  </button>
                ) : null}
              </form>
            ) : <p className="state-copy">{isMerged ? 'Merged records cannot be changed.' : 'Shop and user linkage is available to Growth Managers and Founders.'}</p>}
          </section>

          {canManage && !isMerged ? (
            <section className="content-card" aria-labelledby="merge-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Record hygiene</p>
                  <h3 id="merge-title">Merge prospect</h3>
                </div>
                <GitMerge aria-hidden="true" />
              </div>
              <p className="state-copy">Merge this record into another prospect. The source record becomes merged and cannot be edited.</p>
              <form className="action-form" onSubmit={handleMerge}>
                <label htmlFor="merge-target-id">
                  Target prospect ID
                   <input id="merge-target-id" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} maxLength={36} required />
                </label>
                <label htmlFor="merge-reason">
                  Reason
                   <textarea id="merge-reason" value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} rows={3} maxLength={200} required />
                </label>
                <button className="secondary-button" type="submit" disabled={busyAction !== null}>
                  {busyAction === 'merge' ? 'Merging' : 'Merge record'}
                </button>
              </form>
            </section>
          ) : null}

          {prospect.status === 'merged' ? (
            <section className="content-card" aria-labelledby="merged-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Record hygiene</p>
                  <h3 id="merged-title">Merged record</h3>
                </div>
                <GitMerge aria-hidden="true" />
              </div>
              <p className="state-copy">
                Merged into{' '}
                {prospect.mergedIntoId ? <Link className="table-link" to={`/prospects/${encodeURIComponent(prospect.mergedIntoId)}`}>{prospect.mergedIntoId}</Link> : 'another prospect'}.
              </p>
              <p className="table-subtext">Merged {formatDate(prospect.mergedAt, true)}</p>
            </section>
          ) : null}
        </aside>
      </div>
      <button className="back-to-list" type="button" onClick={() => navigate('/prospects')}>Return to prospects</button>
    </main>
  );
}
