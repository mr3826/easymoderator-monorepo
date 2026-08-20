import { useEffect, useState, type FormEvent } from 'react';
import { Filter, Plus, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
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
} from '@/api/client';
import { usePermission } from '@/auth/usePermission';

const PAGE_SIZE = 20;
const initialFilters: ProspectListFilters = { page: 1, pageSize: PAGE_SIZE };

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatContact(value: string | null, redacted: boolean | undefined) {
  if (redacted) return 'Hidden for your role';
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
          {formatContact(prospect.contactName, prospect.redacted)}
        </span>
      </th>
      <td>{formatContact(prospect.contactPhone, prospect.redacted)}</td>
      <td>
        <span className="source-code">{codeLabel(prospect.source)}</span>
        {prospect.sourceDetail ? <span className="table-subtext">{prospect.sourceDetail}</span> : null}
      </td>
      <td>{prospect.ownerUserId || 'Unassigned'}</td>
      <td>
        <span className={`status-badge ${statusClass(prospect.status)}`}>
          {codeLabel(prospect.status)}
        </span>
      </td>
      <td>{prospect.linkedShopId || prospect.linkedUserId ? 'Linked' : 'Not linked'}</td>
      <td>
        <span className={prospect.eligibleForNextPhase ? 'eligible-yes' : 'eligible-no'}>
          {prospect.eligibleForNextPhase ? 'Eligible' : 'Not eligible'}
        </span>
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
  const [filters, setFilters] = useState<ProspectListFilters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<ProspectListFilters>(initialFilters);
  const [result, setResult] = useState<ProspectListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canCreate = usePermission('growth_os.prospects.manage_all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    growthApi.getProspects(filters)
      .then((nextResult) => {
        if (active) setResult(nextResult);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError));
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
    setFilters({ ...draftFilters, page: 1, pageSize: draftFilters.pageSize || PAGE_SIZE });
  }

  function resetFilters() {
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
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
            Owner user ID
            <input
              id="prospect-owner"
              value={draftFilters.ownerUserId ?? ''}
              onChange={(event) => setDraftFilters((current) => ({ ...current, ownerUserId: event.target.value }))}
              placeholder="Any owner"
            />
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
                    <th scope="col">Next phase</th>
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
