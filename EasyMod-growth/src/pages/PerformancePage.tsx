import { BarChart3, Tags } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { SourcesPage } from '@/pages/SourcesPage';

type PerformanceTab = 'funnel' | 'sources';

/**
 * Growth Performance consolidates the former standalone Analytics and Sources
 * destinations into one tabbed surface. `/analytics` and `/sources` keep
 * rendering the same page contents standalone so every deep link and the
 * browser-extension handoff remain valid.
 */
export function PerformancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: PerformanceTab = searchParams.get('tab') === 'sources' ? 'sources' : 'funnel';

  const selectTab = (next: PerformanceTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'funnel') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: false });
  };

  return (
    <main className="page-content" aria-labelledby="performance-title">
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Growth reporting</p>
          <h1 id="performance-title">Growth Performance</h1>
          <p className="page-lede">
            Funnel, discipline, and source attribution from the same prospect ledger window.
            Unavailable measures stay marked as not reported.
          </p>
        </div>
      </div>
      <div className="tab-row" role="group" aria-label="Performance views">
        <button
          type="button"
          className={`tab${tab === 'funnel' ? ' active' : ''}`}
          aria-pressed={tab === 'funnel'}
          onClick={() => selectTab('funnel')}
        >
          <BarChart3 aria-hidden="true" />
          <span>Funnel &amp; discipline</span>
        </button>
        <button
          type="button"
          className={`tab${tab === 'sources' ? ' active' : ''}`}
          aria-pressed={tab === 'sources'}
          onClick={() => selectTab('sources')}
        >
          <Tags aria-hidden="true" />
          <span>Source attribution</span>
        </button>
      </div>
      {tab === 'sources' ? <SourcesPage embedded /> : <AnalyticsPage embedded />}
    </main>
  );
}
