import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, ListChecks, RefreshCw, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  growthApi,
  workspaceApi,
  type Followup,
  type HomeResponse,
  type ProspectListItem,
} from '@/api/client';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { LoadingState, MessageState } from '@/components/states';
import { formatGrowthDateTime } from '@/growthTime';

const SEGMENT_PAGE_SIZE = 5;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'This part of the action queue could not be loaded. Please try again.';
}

interface SegmentState<T> {
  loading: boolean;
  error: string | null;
  items: T[];
  total: number;
}

function initialSegment<T>(): SegmentState<T> {
  return { loading: true, error: null, items: [], total: 0 };
}

function daysBefore(dueAt: string, nowMs: number): number {
  const diff = nowMs - new Date(dueAt).getTime();
  return Math.max(1, Math.floor(diff / 86_400_000));
}

function dayLabel(value: string | null | undefined, nowMs: number): string {
  if (!value) return 'an unknown date';
  const diffDays = Math.floor((nowMs - new Date(value).getTime()) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

function FollowupRow({ followup, why }: { followup: Followup; why: string }) {
  return (
    <li className="queue-row">
      <div className="queue-row-main">
        <Link className="queue-row-title" to={`/prospects/${encodeURIComponent(followup.prospectId)}`}>
          {followup.prospectName || 'Prospect'}
        </Link>
        <p className="table-subtext">
          {followup.action} · <span className="why-badge">{why}</span>
        </p>
      </div>
      <Link className="secondary-button" to={`/prospects/${encodeURIComponent(followup.prospectId)}`}>
        Open and record
      </Link>
    </li>
  );
}

function ProspectRow({ prospect, why }: { prospect: ProspectListItem; why: string }) {
  return (
    <li className="queue-row">
      <div className="queue-row-main">
        <Link className="queue-row-title" to={`/prospects/${encodeURIComponent(prospect.id)}`}>
          {prospect.businessName}
        </Link>
        <p className="table-subtext">
          {prospect.source.replace(/_/g, ' ')} · <span className="why-badge">{why}</span>
        </p>
      </div>
      <Link className="secondary-button" to={`/prospects/${encodeURIComponent(prospect.id)}`}>
        Open
      </Link>
    </li>
  );
}

function AttentionCard({ label, value, warn = false, to }: { label: string; value: number; warn?: boolean; to?: string }) {
  const content = (
    <>
      <span className={warn ? 'metric warn' : 'metric'}>{(value ?? 0).toLocaleString()}</span>
      <strong>{label}</strong>
    </>
  );
  return (
    to ? <Link className="attention-card" to={to}>{content}</Link> : <div className="attention-card">{content}</div>
  );
}

type QueueSegmentView = {
  id: string;
  title: string;
  why: string;
  empty: string;
  drill: string;
  loading: boolean;
  error: string | null;
  rows: ReactNode[];
  total: number;
  retry: () => void;
};

export function HomePage() {
  const { reportApiError, session } = useGrowthAuth();
  const canManageFollowups = session?.permissions.includes('growth_os.followups.manage') ?? false;
  const canManageAllProspects = session?.permissions.includes('growth_os.prospects.manage_all') ?? false;
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [overdue, setOverdue] = useState<SegmentState<Followup>>(initialSegment);
  const [dueToday, setDueToday] = useState<SegmentState<Followup>>(initialSegment);
  const [qualifiedUnassigned, setQualifiedUnassigned] = useState<SegmentState<ProspectListItem>>(initialSegment);
  const [stalledOnboarding, setStalledOnboarding] = useState<SegmentState<ProspectListItem>>(initialSegment);
  const [newUnassigned, setNewUnassigned] = useState<SegmentState<ProspectListItem>>(initialSegment);

  const loadFollowupSegment = useCallback(async (
    state: 'overdue' | 'due_today',
    apply: (next: SegmentState<Followup>) => void,
  ) => {
    apply({ loading: true, error: null, items: [], total: 0 });
    try {
      const response = await workspaceApi.listFollowups({ state, owner: 'me', pageSize: SEGMENT_PAGE_SIZE });
      apply({ loading: false, error: null, items: response.items, total: response.total });
    } catch (segmentError) {
      apply({ loading: false, error: errorMessage(segmentError), items: [], total: 0 });
    }
  }, []);

  const loadProspectSegment = useCallback(async (
    fetcher: () => Promise<{ items: ProspectListItem[]; total: number }>,
    apply: (next: SegmentState<ProspectListItem>) => void,
  ) => {
    apply({ loading: true, error: null, items: [], total: 0 });
    try {
      const response = await fetcher();
      apply({ loading: false, error: null, items: response.items, total: response.total });
    } catch (segmentError) {
      apply({ loading: false, error: errorMessage(segmentError), items: [], total: 0 });
    }
  }, []);

  const fetchQualifiedUnassigned = useCallback(() => loadProspectSegment(
    () => growthApi.getProspects({ status: 'qualified', owner: 'unassigned', pageSize: SEGMENT_PAGE_SIZE }),
    setQualifiedUnassigned,
  ), [loadProspectSegment]);

  const fetchStalledOnboarding = useCallback(() => home && loadProspectSegment(
    () => growthApi.getProspects({
      status: 'onboarding',
      stalledBefore: home.windows.stalledBefore,
      pageSize: SEGMENT_PAGE_SIZE,
    }),
    setStalledOnboarding,
  ), [loadProspectSegment, home]);

  const fetchNewUnassigned = useCallback(() => loadProspectSegment(
    () => growthApi.getProspects({ status: 'new', owner: 'unassigned', pageSize: SEGMENT_PAGE_SIZE }),
    setNewUnassigned,
  ), [loadProspectSegment]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workspaceApi.home()
      .then((nextHome) => {
        if (!active) return;
        setHome(nextHome);
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
  }, [reloadToken, reportApiError]);

  useEffect(() => {
    if (!home) return;
    if (canManageFollowups) {
      void loadFollowupSegment('overdue', setOverdue);
      void loadFollowupSegment('due_today', setDueToday);
    }
    void fetchQualifiedUnassigned();
    void fetchStalledOnboarding();
    void fetchNewUnassigned();
  }, [
    home,
    canManageFollowups,
    loadFollowupSegment,
    fetchQualifiedUnassigned,
    fetchStalledOnboarding,
    fetchNewUnassigned,
  ]);

  if (loading) return <LoadingState />;

  if (error || !home) {
    return (
      <MessageState eyebrow="Sales & Growth" title="Today is unavailable">
        <p>{error || 'No overview data was returned.'}</p>
        <button className="secondary-button" type="button" onClick={() => setReloadToken((current) => current + 1)}>
          Try again
        </button>
      </MessageState>
    );
  }

  const { myWork, growthAttention } = home;
  const nowMs = new Date(home.generatedAt).getTime() || Date.now();

  const segments: QueueSegmentView[] = [
    {
      id: 'overdue',
      title: 'Overdue follow-ups',
      why: 'Past their business-day deadline in Asia/Dhaka. Complete or reschedule these first.',
      empty: 'Nothing overdue for you.',
      drill: '/my-work?state=overdue',
      loading: overdue.loading,
      error: overdue.error,
      total: overdue.total,
      rows: overdue.items.map((item) => (
        <FollowupRow
          key={item.id}
          followup={item}
          why={`Overdue by ${daysBefore(item.dueAt, nowMs)} day${daysBefore(item.dueAt, nowMs) === 1 ? '' : 's'}`}
        />
      )),
      retry: () => void loadFollowupSegment('overdue', setOverdue),
    },
    {
      id: 'due-today',
      title: 'Due today',
      why: 'Scheduled for the current business day. Do these next, while the timing still helps the merchant.',
      empty: 'Nothing due today.',
      drill: '/my-work?state=due_today',
      loading: dueToday.loading,
      error: dueToday.error,
      total: dueToday.total,
      rows: dueToday.items.map((item) => (
        <FollowupRow key={item.id} followup={item} why={`Due ${formatGrowthDateTime(item.dueAt)}`} />
      )),
      retry: () => void loadFollowupSegment('due_today', setDueToday),
    },
    {
      id: 'qualified-unassigned',
      title: 'Qualified leads without an owner',
      why: 'Someone marked these leads as qualified, but nobody owns the next contact. Assign and act.',
      empty: 'Every qualified lead has an owner.',
      drill: '/prospects?status=qualified&owner=unassigned',
      loading: qualifiedUnassigned.loading,
      error: qualifiedUnassigned.error,
      total: qualifiedUnassigned.total,
      rows: qualifiedUnassigned.items.map((item) => (
        <ProspectRow
          key={item.id}
          prospect={item}
          why={`Unassigned since ${dayLabel(item.statusChangedAt ?? item.createdAt, nowMs)}`}
        />
      )),
      retry: () => void fetchQualifiedUnassigned(),
    },
    {
      id: 'stalled-onboarding',
      title: 'Onboarding stalled 15+ days',
      why: 'Between qualification and their first AI reply for two weeks or more. Find out what blocks activation.',
      empty: 'No onboarding has been stalled for 15 days or more.',
      drill: `/prospects?status=onboarding&stalledBefore=${encodeURIComponent(home.windows.stalledBefore)}`,
      loading: stalledOnboarding.loading,
      error: stalledOnboarding.error,
      total: stalledOnboarding.total,
      rows: stalledOnboarding.items.map((item) => (
        <ProspectRow
          key={item.id}
          prospect={item}
          why={`Still onboarding since ${dayLabel(item.statusChangedAt, nowMs)}`}
        />
      )),
      retry: () => void fetchStalledOnboarding(),
    },
    {
      id: 'new-unassigned',
      title: 'Other open leads to start',
      why: 'New leads nobody has claimed yet. Make first contact or hand them to an owner.',
      empty: 'No unclaimed new leads.',
      drill: '/prospects?status=new&owner=unassigned',
      loading: newUnassigned.loading,
      error: newUnassigned.error,
      total: newUnassigned.total,
      rows: newUnassigned.items.map((item) => (
        <ProspectRow
          key={item.id}
          prospect={item}
          why={`Captured ${dayLabel(item.sourceRecordedAt ?? item.createdAt, nowMs)}`}
        />
      )),
      retry: () => void fetchNewUnassigned(),
    },
  ].filter((segment) => (segment.id === 'overdue' || segment.id === 'due-today') === false
    || canManageFollowups);

  return (
    <main className="page-content" aria-labelledby="home-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Sales &amp; Growth</p>
          <h1 id="home-title">Today</h1>
          <p className="page-lede">
            Your ordered action queue for the current business day ({home.windows.businessTimeZone}).
            Every row opens the real record behind it.
          </p>
        </div>
        <div className="button-row">
          {canManageAllProspects ? (
            <Link className="primary-button" to="/prospects/new">
              <UserPlus aria-hidden="true" />
              <span>Add prospect</span>
            </Link>
          ) : null}
          <button className="icon-button" type="button" aria-label="Refresh overview" title="Refresh overview" onClick={() => setReloadToken((current) => current + 1)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="table-subtext">
        Queue computed {formatGrowthDateTime(home.generatedAt)} —
        {' '}{myWork.followupsOverdueMine} overdue and {myWork.followupsOpenMine} open follow-ups assigned to you.
      </p>

      <section className="action-queue" aria-label="Action queue">
        {segments.map((segment) => (
          <section className="content-card queue-segment" key={segment.id} aria-labelledby={`queue-${segment.id}`}>
            <div className="section-heading">
              <div>
                <h3 id={`queue-${segment.id}`}>{segment.title}</h3>
                <p className="table-subtext">{segment.why}</p>
              </div>
              <ListChecks aria-hidden="true" />
            </div>
            {segment.loading ? (
              <div className="list-skeleton" aria-label={`Loading ${segment.title}`}>
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </div>
            ) : segment.error ? (
              <div className="inline-state error-state compact-state" role="alert">
                <p>{segment.error}</p>
                <button className="secondary-button" type="button" onClick={segment.retry}>
                  Retry this list
                </button>
              </div>
            ) : segment.rows.length === 0 ? (
              <div className="inline-state empty-state compact-state">
                <p>{segment.empty}</p>
              </div>
            ) : (
              <>
                <ul className="queue-list">{segment.rows}</ul>
                <div className="queue-footer">
                  <span className="table-subtext">
                    Showing {segment.rows.length} of {segment.total.toLocaleString()}
                  </span>
                  <Link className="table-link" to={segment.drill}>View all</Link>
                </div>
              </>
            )}
          </section>
        ))}
      </section>

      <section className="content-card" aria-labelledby="growth-attention-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">In your permission scope</p>
            <h3 id="growth-attention-title">This week</h3>
          </div>
          <Activity aria-hidden="true" />
        </div>
        <div className="attention-grid">
          <AttentionCard
            label="New leads (last 7 days)"
            value={growthAttention.newLeadsLast7d}
            to={`/prospects?status=new&createdAfter=${encodeURIComponent(home.windows.attentionSince)}&createdBefore=${encodeURIComponent(home.windows.attentionUntil)}`}
          />
          <AttentionCard label="Qualified open" value={growthAttention.qualifiedOpen} to="/prospects?status=qualified" />
          {canManageAllProspects ? <AttentionCard label="Qualified unassigned" value={growthAttention.unassignedQualified} to="/prospects?status=qualified&owner=unassigned" /> : null}
          <AttentionCard label="Onboarding open" value={growthAttention.onboardingOpen} to="/prospects?status=onboarding" />
          <AttentionCard
            label="Onboarding stalled (15+ days)"
            value={growthAttention.onboardingStalledOver15d}
            warn={growthAttention.onboardingStalledOver15d > 0}
            to={`/prospects?status=onboarding&stalledBefore=${encodeURIComponent(home.windows.stalledBefore)}`}
          />
          <AttentionCard
            label="Qualified stalled (15+ days)"
            value={growthAttention.qualifiedStalledOver15d}
            warn={growthAttention.qualifiedStalledOver15d > 0}
            to={`/prospects?status=qualified&stalledBefore=${encodeURIComponent(home.windows.stalledBefore)}`}
          />
          <AttentionCard
            label="AI activated (last 7 days)"
            value={growthAttention.convertedLast7d}
            to={`/prospects?activated=true&statusChangedAfter=${encodeURIComponent(home.windows.attentionSince)}&statusChangedBefore=${encodeURIComponent(home.windows.attentionUntil)}`}
          />
          <AttentionCard
            label="Overdue follow-ups in scope"
            value={growthAttention.followupsOverdueInScope}
            warn={growthAttention.followupsOverdueInScope > 0}
            to="/follow-ups?state=overdue"
          />
          <AttentionCard
            label="Due today in scope"
            value={growthAttention.followupsDueTodayInScope}
            to="/follow-ups?state=due_today"
          />
        </div>
        <p className="table-subtext">
          AI activated means the merchant's first successful AI reply — it is not a paid subscription claim.
        </p>
      </section>
    </main>
  );
}
