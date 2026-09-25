import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, ScrollText, Search } from 'lucide-react';
import { adminApi, type Paginated, type PrivilegedAuditEntry } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

const PAGE_SIZE = 50;

const RESOURCE_TYPES = [
  'GROWTH_OS_ROLE',
  'GROWTH_OS_USER_ADMIN',
  'growth_os_prospect',
  'GROWTH_OS_ADMIN_MERCHANT',
] as const;

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatDateTime(value: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function serverMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error && error.message.trim() ? error.message : fallback;
  return raw.replace(/[<>]/g, '').slice(0, 400);
}

export function AuditTrailPage() {
  const { reportApiError } = useGrowthAuth();
  const [searchDraft, setSearchDraft] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [resourceType, setResourceType] = useState<string>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<PrivilegedAuditEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    adminApi.auditLogs({
      ...(searchApplied ? { search: searchApplied } : {}),
      ...(resourceType ? { resourceType } : {}),
      page,
      pageSize: PAGE_SIZE,
    })
      .then((nextResult) => {
        if (active) setResult(nextResult);
      })
      .catch((requestError: unknown) => {
        if (!active || reportApiError(requestError)) return;
        setError(serverMessage(requestError, 'Unable to load the audit trail.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [searchApplied, resourceType, page, reloadToken, reportApiError]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearchApplied(searchDraft.trim());
  }

  function selectResourceType(next: string) {
    setResourceType(next);
    setPage(1);
  }

  const total = result?.total ?? 0;
  const pageSize = result?.pageSize ?? result?.limit ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = result?.page ?? page;

  return (
    <main className="page-content" aria-labelledby="audit-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Privileged actions</p>
          <h2 id="audit-title">Audit trail</h2>
          <p className="page-lede">
            Every Super Admin mutation with its written reason. Secret-like fields are redacted by
            the server before they reach this view.
          </p>
        </div>
      </div>

      <section className="content-card filter-card" aria-labelledby="audit-filters-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Narrow the trail</p>
            <h3 id="audit-filters-title">Filters</h3>
          </div>
          <Search aria-hidden="true" />
        </div>
        <form className="filter-form" onSubmit={submitSearch}>
          <label htmlFor="audit-query">
            Search by action
            <span className="input-with-icon">
              <Search aria-hidden="true" />
              <input
                id="audit-query"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="For example: merchant.suspend"
              />
            </span>
          </label>
          <div className="filter-actions">
            <button className="primary-button" type="submit">Apply search</button>
          </div>
        </form>
        <div className="tab-row" role="group" aria-label="Resource type filter">
          <button
            type="button"
            className={resourceType === '' ? 'active' : undefined}
            aria-pressed={resourceType === ''}
            onClick={() => selectResourceType('')}
          >
            All resources
          </button>
          {RESOURCE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={resourceType === type ? 'active' : undefined}
              aria-pressed={resourceType === type}
              aria-label={`Filter by ${type}`}
              onClick={() => selectResourceType(type)}
            >
              {codeLabel(type)}
            </button>
          ))}
        </div>
      </section>

      <section className="content-card" aria-labelledby="audit-results-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Append-only</p>
            <h3 id="audit-results-title">
              {loading ? 'Loading audit entries' : `${total.toLocaleString()} privileged action${total === 1 ? '' : 's'}`}
            </h3>
          </div>
          <div className="button-row">
            <ScrollText aria-hidden="true" />
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh audit trail"
              title="Refresh audit trail"
              onClick={() => setReloadToken((current) => current + 1)}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="list-skeleton" aria-label="Loading audit entries">
            {['one', 'two', 'three', 'four'].map((row) => <div className="skeleton-row" key={row} />)}
          </div>
        ) : null}
        {!loading && error ? (
          <div className="inline-state error-state" role="alert">
            <strong>The audit trail could not be loaded.</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error && result && result.items.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No privileged actions match these filters.</strong>
            <p>Suspend the search or choose a different resource type.</p>
          </div>
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Privileged audit entries</caption>
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Resource</th>
                    <th scope="col">Shop</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Change data</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((entry) => (
                    <tr key={entry.id}>
                      <th scope="row">
                        <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                      </th>
                      <td>
                        {entry.actor?.name || entry.actor?.userId || 'Unknown actor'}
                        {entry.actor?.name && entry.actor.userId ? (
                          <span className="table-subtext">{entry.actor.userId}</span>
                        ) : null}
                      </td>
                      <td>{entry.action}</td>
                      <td>
                        {entry.resourceType}
                        <span className="table-subtext">{entry.resourceId || 'No ID recorded'}</span>
                      </td>
                      <td>{entry.shopId || '—'}</td>
                      <td>{entry.reason || 'No reason recorded'}</td>
                      <td>
                        {entry.oldValues || entry.newValues ? (
                          <details>
                            <summary>View change data</summary>
                            <pre className="json-block">
                              {JSON.stringify({ before: entry.oldValues, after: entry.newValues }, null, 2)}
                            </pre>
                          </details>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination" aria-label="Audit pages">
              <span>Page {currentPage} of {totalPages}</span>
              <div className="pagination-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <p className="field-hint">
        IP addresses are captured server-side for incident response and are intentionally not
        rendered here.
      </p>
    </main>
  );
}
