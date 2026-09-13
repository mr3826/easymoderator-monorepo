import {
  BarChart3,
  Building2,
  Gauge,
  Home,
  KeyRound,
  ListChecks,
  LogOut,
  PlusCircle,
  ScrollText,
  Search,
  ShieldCheck,
  Tags,
  UserCog,
  UsersRound,
  Workflow,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useGrowthAuth } from '@/auth/GrowthAuthProvider';
import { PROSPECT_READ_PERMISSIONS } from '@/auth/usePermission';

type NavEntry = { to: string; label: string; icon: typeof Home; end?: boolean };
type NavGroup = { id: string; label: string; permission?: string | readonly string[]; entries: NavEntry[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    entries: [
      { to: '/', label: 'Home', icon: Home, end: true },
      { to: '/my-work', label: 'My Work', icon: ListChecks },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    permission: PROSPECT_READ_PERMISSIONS,
    entries: [
      { to: '/prospects', label: 'Prospects', icon: UsersRound },
      { to: '/pipeline', label: 'Pipeline', icon: Workflow },
      { to: '/follow-ups', label: 'Follow-ups', icon: PlusCircle },
      { to: '/sources', label: 'Sources', icon: Tags },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'merchant-insights',
    // Merchants renders a masked read-only view for GROWTH_USER and the full
    // admin list for SUPER_ADMIN; the backend chooses the response shape per
    // request. Navigation visibility mirrors that: both roles see the group,
    // the data depth is enforced server-side.
    label: 'Merchant Insights',
    permission: ['growth_os.merchants.read_insight', 'growth_os.admin.merchants.read'],
    entries: [
      { to: '/merchants', label: 'Merchants', icon: Building2 },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    permission: 'growth_os.admin.operations.read',
    entries: [
      { to: '/operations', label: 'Operations', icon: Gauge },
      { to: '/audit', label: 'Audit', icon: ScrollText },
    ],
  },
  {
    id: 'system',
    label: 'System',
    permission: 'growth_os.admin.users.read',
    entries: [
      { to: '/growth-users', label: 'Growth Users', icon: UserCog },
      { to: '/access-control', label: 'Access Control', icon: KeyRound },
    ],
  },
];

function toList(permission?: string | readonly string[]): string[] {
  if (!permission) return [];
  if (typeof permission === 'string') return [permission];
  return permission.slice();
}

export function GrowthShell() {
  const { session, error, logout, status } = useGrowthAuth();
  const navigate = useNavigate();
  const granted = new Set(session?.permissions ?? []);
  // Hide groups whose permissions the account lacks; the server remains the
  // authorization authority no matter what renders here.
  const visibleGroups = status === 'authenticated'
    ? NAV_GROUPS.filter((group) => {
      const required = toList(group.permission);
      return required.length === 0 || required.some((permission) => granted.has(permission));
    })
    : [];

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Growth OS navigation">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <p className="brand-name">Growth OS</p>
            <p className="brand-subtitle">Internal acquisition</p>
          </div>
        </div>

        <nav className="nav-list">
          {visibleGroups.map((group) => (
            <section className="nav-group" key={group.id}>
              <p className="nav-group-label">{group.label}</p>
              {group.entries.map((entry) => (
                <NavLink
                  key={entry.to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  to={entry.to}
                  end={entry.end}
                >
                  <entry.icon aria-hidden="true" />
                  <span>{entry.label}</span>
                </NavLink>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <div className="work-area">
        <header className="topbar">
          <div className="topbar-search">
            <form
              className="global-search-form"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem('q');
                const value = input instanceof HTMLInputElement ? input.value.trim() : '';
                if (value) navigate(`/search?q=${encodeURIComponent(value)}`);
              }}
            >
              <input
                name="q"
                type="search"
                placeholder="Search prospects, merchants…"
                aria-label="Global internal search"
              />
            </form>
          </div>
          <div>
            <p className="eyebrow">Internal workspace</p>
            <h1>Growth OS</h1>
          </div>
          <div className="user-strip">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>{session?.displayName}</strong>
              <span>{session?.role}</span>
            </div>
            <button className="icon-button" type="button" aria-label="Log out" title="Log out" onClick={() => void logout()}>
              <LogOut aria-hidden="true" />
            </button>
          </div>
        </header>
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <Outlet />
      </div>
    </div>
  );
}
