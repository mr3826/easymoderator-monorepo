import { useEffect, useState, type FormEvent } from 'react';
import { Filter, Plus, RefreshCw, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  growthApi,
  PROSPECT_SOURCES,
  PROSPECT_STATUSES,
  type ProspectListFilters,
  type ProspectListItem,
  type ProspectListResponse,
  type ProspectSource,
  type ProspectStatus,
  type GrowthAssignee,
} from '@/api/client';
import { usePermission } from '@/auth/usePermission';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeInitialFilters(searchParams: URLSearchParams): ProspectListFilters {
  const filters: ProspectListFilters = { page: 1, pageSize: PAGE_SIZE };
  const status = searchParams.get('status');
  const source = searchParams.get('source');
  const owner = searchParams.get('owner');
  const stage = searchParams.get('stage');
  const stalled = searchParams.get('stalled');
  const createdAfter = searchParams.get('createdAfter');
  const createdBefore = searchParams.get('createdBefore');
  const statusChangedAfter = searchParams.get('statusChangedAfter');
  const statusChangedBefore = searchParams.get('statusChangedBefore');
  const sourceRecordedAfter = searchParams.get('sourceRecordedAfter');
  const sourceRecordedBefore = searchParams.get('sourceRecordedBefore');
  if (status && (PROSPECT_STATUSES as readonly string[]).includes(status)) {
    filters.status = status as ProspectStatus;
  }
  if (source && (PROSPECT_SOURCES as readonly string[]).includes(source)) {
    filters.source = source as ProspectSource;
  }
  if (owner === 'me' || owner === 'unassigned' || (owner && UUID_PATTERN.test(owner))) filters.owner = owner;
  if (stage === 'qualified') filters.stage = stage;
  if (stalled === 'true') filters.stalled = true;
  if (createdAfter) filters.createdAfter = createdAfter;
  if (createdBefore) filters.createdBefore = createdBefore;
  if (statusChangedAfter) filters.statusChangedAfter = statusChangedAfter;
  if (statusChangedBefore) filters.statusChangedBefore = statusChangedBefore;
  if (sourceRecordedAfter) filters.sourceRecordedAfter = sourceRecordedAfter;
  if (sourceRecordedBefore) filters.sourceRecordedBefore = sourceRecordedBefore;
  return filters;
}

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatValue(value: string | null) {
  return value || 'Not provided';
}

function statusClass(status: ProspectStatus) {
  return `status-${status.replace(/_/g, '-')}`;
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Unable to load prospects. Please try again.';
}

function ProspectRow({ prospect }: { prospect: ProspectListItem }) {
  return (
    <tr>
      <th scope="row">
        <Link className="table-link" to={`/prospects/${encodeURIComponent(prospect.id)}`}>
          {prospect.businessName}
        </Link>
        <span className="table-subtext">
          {formatValue(prospect.contactName)}
        </span>
      </th>
      <td>{formatValue(prospect.contactPhone)}</td>
      <td>
        <span className="source-code">{codeLabel(prospect.source)}</span>
        {prospect.sourceDetail ? <span className="table-subtext">{prospect.sourceDetail}</span> : null}
      </td>
       <td>{prospect.ownerDisplayName || (prospect.ownerUserId ? 'Historical owner' : 'Unassigned')}</td>
      <td>
        <span className={`status-badge ${statusClass(prospect.status)}`}>
          {codeLabel(prospect.status)}
        </span>
      </td>
      <td>{prospect.linkedShopId || prospect.linkedUserId ? 'Linked' : 'Not linked'}</td>
      <td>
        <span className="table-subtext">Created {formatDate(prospect.createdAt)}</span>
      </td>
    </tr>
  );
}

function LoadingRows() {
  return (
    <div className="list-skeleton" aria-label="Loading prospects">
      {['one', 'two', 'three', 'four', 'five'].map((row) => <div className="skeleton-row" key={row} />)}
    </div>
  );
}

export function ProspectListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialState] = useState(() => makeInitialFilters(searchParams));
  const [filters, setFilters] = useState<ProspectListFilters>(initialState);
  const [draftFilters, setDraftFilters] = useState<ProspectListFilters>(initialState);
  const [result, setResult] = useState<ProspectListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterValidationError, setFilterValidationError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<GrowthAssignee[]>([]);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);
  const canCreate = usePermission('growth_os.prospects.manage_all');
  const { reportApiError } = useGrowthAuth();

  useEffect(() => {
    if (!canCreate) return undefined;
    let active = true;
    growthApi.getEligibleAssignees()
      .then((next) => { if (active) setAssignees(next); })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setAssigneesError(errorMessage(requestError));
      });
    return () => { active = false; };
  }, [canCreate, reportApiError]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    growthApi.getProspects(filters)
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
  }, [filters]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftFilters.ownerUserId?.trim() && !UUID_PATTERN.test(draftFilters.ownerUserId.trim())) {
      setFilterValidationError('Owner user ID must be a valid UUID.');
      return;
    }
    setFilterValidationError(null);
    setFilters({ ...draftFilters, page: 1, pageSize: draftFilters.pageSize || PAGE_SIZE });
    const nextParams = new URLSearchParams();
    if (draftFilters.status) nextParams.set('status', draftFilters.status);
    if (draftFilters.source) nextParams.set('source', draftFilters.source);
    if (draftFilters.owner) nextParams.set('owner', draftFilters.owner);
    // Keep contact/search text out of browser history, referrers, and copied URLs.
    if (draftFilters.stage) nextParams.set('stage', draftFilters.stage);
    if (draftFilters.stalled) nextParams.set('stalled', 'true');
    if (draftFilters.createdAfter) nextParams.set('createdAfter', draftFilters.createdAfter);
    if (draftFilters.createdBefore) nextParams.set('createdBefore', draftFilters.createdBefore);
    if (draftFilters.statusChangedAfter) nextParams.set('statusChangedAfter', draftFilters.statusChangedAfter);
    if (draftFilters.statusChangedBefore) nextParams.set('statusChangedBefore', draftFilters.statusChangedBefore);
    if (draftFilters.sourceRecordedAfter) nextParams.set('sourceRecordedAfter', draftFilters.sourceRecordedAfter);
    if (draftFilters.sourceRecordedBefore) nextParams.set('sourceRecordedBefore', draftFilters.sourceRecordedBefore);
    setSearchParams(nextParams);
  }

  function resetFilters() {
    setDraftFilters(initialState);
    setFilters(initialState);
    setFilterValidationError(null);
  }

  const total = result?.total ?? 0;
  const currentPage = result?.page ?? filters.page ?? 1;
  const currentPageSize = result?.pageSize ?? filters.pageSize ?? PAGE_SIZE;
  const totalPages = result?.totalPages ?? Math.max(1, Math.ceil(total / currentPageSize));

  return (
    <main className="page-content" aria-labelledby="prospects-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Acquisition ledger</p>
          <h2 id="prospects-title">Prospects</h2>
          <p className="page-lede">Capture, qualify, and assign the next conversation without leaving the Growth workspace.</p>
        </div>
        {canCreate ? (
          <Link className="primary-button" to="/prospects/new">
            <Plus aria-hidden="true" />
            <span>New prospect</span>
          </Link>
        ) : null}
      </div>

      <section className="content-card filter-card" aria-labelledby="prospect-filters-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Find a record</p>
            <h3 id="prospect-filters-title">Filters</h3>
          </div>
          <Filter aria-hidden="true" />
        </div>
        <form className="filter-form" onSubmit={submitFilters}>
          <label htmlFor="prospect-query">
            Search
            <span className="input-with-icon">
              <Search aria-hidden="true" />
              <input
                id="prospect-query"
                value={draftFilters.q ?? ''}
                onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
                placeholder="Business, contact, phone, or email"
                type="search"
              />
            </span>
          </label>
          <label htmlFor="prospect-status">
            Lifecycle status
            <select
              id="prospect-status"
              value={draftFilters.status ?? ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                status: event.target.value as ProspectStatus | '',
              }))}
            >
              <option value="">All statuses</option>
              {PROSPECT_STATUSES.map((status) => <option key={status} value={status}>{codeLabel(status)}</option>)}
            </select>
          </label>
          <label htmlFor="prospect-source">
            Source
            <select
              id="prospect-source"
              value={draftFilters.source ?? ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                source: event.target.value as ProspectSource | '',
              }))}
            >
              <option value="">All sources</option>
              {PROSPECT_SOURCES.map((source) => <option key={source} value={source}>{codeLabel(source)}</option>)}
            </select>
          </label>
           <label htmlFor="prospect-owner">
             Owner
             <select
               id="prospect-owner"
               value={draftFilters.owner ?? ''}
               onChange={(event) => setDraftFilters((current) => ({ ...current, owner: event.target.value, ownerUserId: undefined }))}
             >
               <option value="">Any owner</option>
               <option value="me">Mine</option>
               <option value="unassigned">Unassigned</option>
               {assignees.map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.displayName}</option>)}
             </select>
           </label>
          <label htmlFor="prospect-linked">
            Linkage
            <select
              id="prospect-linked"
              value={draftFilters.linked === true || draftFilters.linked === 'true'
                ? 'true'
                : draftFilters.linked === false || draftFilters.linked === 'false' ? 'false' : ''}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                linked: event.target.value as ProspectListFilters['linked'],
              }))}
            >
              <option value="">Any linkage</option>
              <option value="true">Linked</option>
              <option value="false">Not linked</option>
            </select>
          </label>
          <label htmlFor="prospect-page-size">
            Rows per page
            <select
              id="prospect-page-size"
              value={draftFilters.pageSize ?? PAGE_SIZE}
              onChange={(event) => setDraftFilters((current) => ({ ...current, pageSize: Number(event.target.value) }))}
            >
              {[20, 50, 100].map((pageSize) => <option key={pageSize} value={pageSize}>{pageSize}</option>)}
            </select>
          </label>
          <div className="filter-actions">
            <button className="primary-button" type="submit">Apply filters</button>
            <button className="secondary-button" type="button" onClick={resetFilters}>Reset</button>
          </div>
        </form>
        {filterValidationError ? <p className="form-error" role="alert">{filterValidationError}</p> : null}
        {assigneesError ? <p className="form-error" role="alert">Owner options unavailable: {assigneesError}</p> : null}
      </section>

      <section className="content-card" aria-labelledby="prospect-results-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Permission-scoped records</p>
            <h3 id="prospect-results-title">
              {loading ? 'Loading prospects' : `${total.toLocaleString()} prospect${total === 1 ? '' : 's'}`}
            </h3>
          </div>
          <button className="icon-button" type="button" aria-label="Refresh prospects" title="Refresh prospects" onClick={() => setFilters((current) => ({ ...current }))}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>

        {loading ? <LoadingRows /> : null}
        {!loading && error ? (
          <div className="inline-state error-state" role="alert">
            <strong>Prospects could not be loaded.</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => setFilters((current) => ({ ...current }))}>Try again</button>
          </div>
        ) : null}
        {!loading && !error && result?.items.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No prospects match these filters.</strong>
            <p>Clear the filters or capture the first prospect for this workspace.</p>
            {canCreate ? <Link className="secondary-button" to="/prospects/new">Create a prospect</Link> : null}
          </div>
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Prospects visible to your Growth OS role</caption>
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Source</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Status</th>
                    <th scope="col">Linkage</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>{result.items.map((prospect) => <ProspectRow key={prospect.id} prospect={prospect} />)}</tbody>
              </table>
            </div>
            <div className="pagination" aria-label="Prospect pages">
              <span>Page {currentPage} of {totalPages}</span>
              <div className="pagination-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setFilters((current) => ({ ...current, page: currentPage - 1 }))}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setFilters((current) => ({ ...current, page: currentPage + 1 }))}
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
