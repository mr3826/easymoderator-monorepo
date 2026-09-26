import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { workspaceApi, type GrowthAnalyticsResponse, type ProspectStatus } from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState, MessageState } from '@/components/states';

const WINDOWS = [30, 90, 180, 365] as const;

function codeLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Growth analytics could not be loaded. Please try again.';
}

function hoursLabel(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString()} h`;
}

function statusClass(status: ProspectStatus) {
  return `status-${status.replace(/_/g, '-')}`;
}

function rateLabel(value: number | null) {
  return value === null ? '—' : `${value}%`;
}

export function AnalyticsPage() {
  const { reportApiError } = useGrowthAuth();
  const [windowDays, setWindowDays] = useState<number>(90);
  const [data, setData] = useState<GrowthAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.growthAnalytics(windowDays)
      .then((nextData) => {
        if (active) setData(nextData);
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
  }, [reportApiError, reloadToken, windowDays]);

  if (loading) return <LoadingState />;

  if (error || !data) {
    return (
      <MessageState eyebrow="Growth reporting" title="Analytics unavailable">
        <p>{error || 'No analytics window was returned.'}</p>
        <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
          Try again
        </button>
      </MessageState>
    );
  }

  // Defensive normalization for SPA/backend version skew (for example a
  // backend rollback while this image still runs): a missing section renders
  // neutral values instead of crashing the whole app at the route boundary.
  const EMPTY_DISCIPLINE: GrowthAnalyticsResponse['followupDiscipline'] = {
    total: 0, open: 0, completed: 0, cancelled: 0,
    completedOnTime: 0, completedLate: 0, overdueOpen: 0, onTimeRatePct: null,
  };
  const cohort = (data.cohort ?? {}) as Partial<GrowthAnalyticsResponse['cohort']>;
  const discipline = data.followupDiscipline ?? EMPTY_DISCIPLINE;
  const ownerRows = data.byOwner ?? [];
  const unassigned = data.unassigned ?? { openCount: 0, oldestSourceRecordedAt: null, oldestAgeDays: null };
  const funnel = data.funnel ?? {
    created: 0, contactedOrBeyond: 0, qualified: 0, onboarding: 0, activated: 0, lost: 0,
  };
  const conversion = data.conversion ?? { createdToActivated: null };
  const timing = data.timing ?? {
    medianHoursToFirstContact: null,
    medianHoursToQualification: null,
    medianHoursToFirstFollowup: null,
    medianHoursCreatedToActivated: null,
  };

  const cohortQuery = new URLSearchParams();
  if (cohort.sourceRecordedFrom) cohortQuery.set('sourceRecordedAfter', cohort.sourceRecordedFrom);
  if (cohort.sourceRecordedTo) cohortQuery.set('sourceRecordedBefore', cohort.sourceRecordedTo);
  const cohortBase = cohortQuery.toString();
  const cohortSuffix = cohortBase ? `&${cohortBase}` : '';

  // Every funnel step the ledger can express drills through to the exact same
  // population its number was counted from; `activated=true` is the canonical
  // activation predicate shared with Home and Sources.
  const funnelSteps: Array<{ label: string; value: number; drill?: string }> = [
    { label: 'Created', value: funnel.created, drill: cohortBase ? `/prospects?${cohortBase}` : '/prospects' },
    { label: 'Contacted or beyond', value: funnel.contactedOrBeyond },
    { label: 'Qualified or beyond', value: funnel.qualified, drill: `/prospects?stage=qualified${cohortSuffix}` },
    { label: 'Onboarding', value: funnel.onboarding, drill: `/prospects?status=onboarding${cohortSuffix}` },
    { label: 'Growth activated', value: funnel.activated, drill: `/prospects?activated=true${cohortSuffix}` },
  ];
  const funnelMax = Math.max(1, ...funnelSteps.map((step) => step.value));
  const statusRows = Object.entries(data.byStatus ?? {})
    .filter((entry): entry is [ProspectStatus, number] => typeof entry[1] === 'number')
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  return (
    <main className="page-content" aria-labelledby="analytics-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Growth reporting</p>
          <h1 id="analytics-title">Analytics</h1>
          <p className="page-lede">Funnel, conversion, and timing measures from the prospect ledger for the selected window.</p>
        </div>
        <div className="button-row">
          <button className="icon-button" type="button" aria-label="Refresh analytics" title="Refresh analytics" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tab-row" role="group" aria-label="Analytics window">
        {WINDOWS.map((windowOption) => (
          <button
            key={windowOption}
            type="button"
            className={windowOption === windowDays ? 'active' : undefined}
            aria-pressed={windowOption === windowDays}
            onClick={() => setWindowDays(windowOption)}
          >
            {windowOption} days
          </button>
        ))}
      </div>

      <section className="content-card" aria-labelledby="funnel-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Last {data.windowDays} days</p>
            <h3 id="funnel-title">Growth funnel</h3>
          </div>
        </div>
        <ul className="funnel-steps">
          {funnelSteps.map((step) => (
     <li key={step.label}>
              <span>{step.label}</span>
              <span className="funnel-bar" style={{ width: `${Math.round((step.value / funnelMax) * 100)}%` }} aria-hidden="true" />
               <strong>{step.drill
                  ? <Link to={step.drill}>{step.value.toLocaleString()}</Link>
                  : step.value.toLocaleString()}</strong>
            </li>
          ))}
        </ul>
      </section>

      <div className="attention-grid">
        <div className="content-card attention-card">
          <span className={funnel.lost > 0 ? 'metric warn' : 'metric'}>{funnel.lost.toLocaleString()}</span>
          <strong>Lost in window</strong>
        </div>
        <div className="content-card attention-card">
          <span className="metric">{conversion.createdToActivated === null ? '—' : `${conversion.createdToActivated}%`}</span>
          <strong>Lead to Growth activation</strong>
        </div>
        <div className="content-card attention-card">
          <span className="metric">{hoursLabel(timing.medianHoursToFirstContact)}</span>
          <strong>Median hours to first contact</strong>
        </div>
        <div className="content-card attention-card">
            <span className="metric">{hoursLabel(timing.medianHoursCreatedToActivated)}</span>
            <strong>Median hours to Growth activation</strong>
        </div>
      </div>

      <section className="content-card" aria-labelledby="discipline-breakdown-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Follow-up loop, ledger-wide</p>
            <h3 id="discipline-breakdown-title">Follow-up discipline</h3>
          </div>
        </div>
        <div className="attention-grid">
          <div className="content-card attention-card">
            <span className={discipline.onTimeRatePct !== null && discipline.onTimeRatePct < 80 ? 'metric warn' : 'metric'}>{rateLabel(discipline.onTimeRatePct)}</span>
            <strong>Completed on time</strong>
          </div>
          <div className="content-card attention-card">
            <span className="metric">{discipline.completedLate.toLocaleString()}</span>
            <strong>Completed late</strong>
          </div>
          <div className="content-card attention-card">
            <span className={discipline.overdueOpen > 0 ? 'metric warn' : 'metric'}>{discipline.overdueOpen.toLocaleString()}</span>
            <strong>Open overdue</strong>
          </div>
          <div className="content-card attention-card">
            <span className="metric">{discipline.cancelled.toLocaleString()}</span>
            <strong>Cancelled</strong>
          </div>
        </div>
      </section>

      <section className="content-card" aria-labelledby="owner-performance-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Source cohort of the selected window</p>
            <h3 id="owner-performance-title">Owner performance</h3>
          </div>
          <p className="state-copy">
            {unassigned.openCount.toLocaleString()} unassigned live prospect{unassigned.openCount === 1 ? '' : 's'}
            {unassigned.oldestAgeDays !== null
              ? ` · oldest ${unassigned.oldestAgeDays.toLocaleString()} day${unassigned.oldestAgeDays === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Owner-attributed cohort performance with qualification and activation rates</caption>
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Created+</th>
                <th scope="col">Qualified+</th>
                <th scope="col">Converted+</th>
                <th scope="col">Qualification rate</th>
                <th scope="col">Activation rate</th>
              </tr>
            </thead>
            <tbody>
              {ownerRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-subtext">No owner-attributed prospects were captured in this cohort.</td>
                </tr>
              ) : ownerRows.map((row, ownerIndex) => (
                <tr key={row.ownerUserId ?? `owner-row-${ownerIndex}`}>
                  <th scope="row">
                    {row.ownerUserId
                      ? <Link className="table-link" to={`/prospects?owner=${encodeURIComponent(row.ownerUserId)}`}>{row.displayName}</Link>
                      : <span>{row.displayName}</span>}
                  </th>
                  <td>{row.created.toLocaleString()}</td>
                  <td>{row.qualified.toLocaleString()}</td>
                  <td>{row.converted.toLocaleString()}</td>
                  <td>{rateLabel(row.qualificationRatePct)}</td>
                  <td>{rateLabel(row.activationRatePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card" aria-labelledby="status-breakdown-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ledger snapshot</p>
            <h3 id="status-breakdown-title">Prospects by status</h3>
          </div>
        </div>
        {statusRows.length === 0 ? (
          <div className="inline-state empty-state">
            <strong>No prospects were created in this window.</strong>
            <p>Choose a longer window or capture new records from the ledger.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Prospects whose source was recorded in the window, grouped by current status</caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map(([status, count]) => (
                  <tr key={status}>
                    <th scope="row">
                      <span className={`status-badge ${statusClass(status)}`}>{codeLabel(status)}</span>
                    </th>
                     <td><Link to={`/prospects?status=${encodeURIComponent(status)}${cohortSuffix}`}>{count.toLocaleString()}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="content-card" aria-labelledby="not-reported-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Honest reporting</p>
            <h3 id="not-reported-title">Not reported</h3>
          </div>
        </div>
        {(data.notAvailable ?? []).length === 0 ? (
          <p className="timeline-note">Nothing was omitted for this window.</p>
        ) : (
          <ul className="work-list">
            {data.notAvailable.map((metric) => (
              <li className="work-item" key={metric}>
                <strong>{codeLabel(metric)}</strong>
                <span className="table-subtext">No source data is recorded for this measure yet.</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
