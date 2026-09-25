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
import { PROSPECT_READ_PERMISSIONS, REPORT_READ_PERMISSIONS, type PermissionInput } from '@/auth/usePermission';

type NavEntry = { to: string; label: string; icon: typeof Home; end?: boolean; permission?: PermissionInput };
type NavGroup = { id: string; label: string; entries: NavEntry[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    entries: [
      { to: '/', label: 'Home', icon: Home, end: true, permission: 'growth_os.prospects.read_all' },
      { to: '/my-work', label: 'My Work', icon: ListChecks, permission: 'growth_os.followups.manage' },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    entries: [
      { to: '/prospects', label: 'Prospects', icon: UsersRound, permission: PROSPECT_READ_PERMISSIONS },
      { to: '/quick-add', label: 'Quick Add', icon: PlusCircle, permission: 'growth_os.prospects.manage_all' },
      { to: '/pipeline', label: 'Pipeline', icon: Workflow, permission: PROSPECT_READ_PERMISSIONS },
      { to: '/follow-ups', label: 'Follow-ups', icon: PlusCircle, permission: 'growth_os.followups.manage' },
      { to: '/sources', label: 'Sources', icon: Tags, permission: REPORT_READ_PERMISSIONS },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: REPORT_READ_PERMISSIONS },
    ],
  },
  {
    id: 'merchant-insights',
    label: 'Merchant Insights',
    entries: [
      {
        to: '/merchants',
        label: 'Merchants',
        icon: Building2,
        permission: ['growth_os.merchants.read_insight', 'growth_os.admin.merchants.read'],
      },
      { to: '/search', label: 'Search', icon: Search, permission: 'growth_os.search.read' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    entries: [
      { to: '/operations', label: 'Operations', icon: Gauge, permission: 'growth_os.admin.operations.read' },
      { to: '/audit', label: 'Audit', icon: ScrollText, permission: 'growth_os.admin.audit.read' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    entries: [
      { to: '/growth-users', label: 'Growth Users', icon: UserCog, permission: 'growth_os.admin.users.read' },
      { to: '/access-control', label: 'Access Control', icon: KeyRound, permission: 'growth_os.admin.users.read' },
    ],
  },
];

function toList(permission?: PermissionInput): string[] {
  if (!permission) return [];
  if (typeof permission === 'string') return [permission];
  return permission.slice();
}

export function GrowthShell() {
  const { session, error, logout, status } = useGrowthAuth();
  const navigate = useNavigate();
  const granted = new Set(session?.permissions ?? []);
  // Hide entries whose permissions the account lacks; the server remains the
  // authorization authority no matter what renders here.
  const visibleGroups = status === 'authenticated'
    ? NAV_GROUPS.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        const required = toList(entry.permission);
        return required.length === 0 || required.some((permission) => granted.has(permission));
      }),
    })).filter((group) => group.entries.length > 0)
    : [];
  const canSearch = granted.has('growth_os.search.read');

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
          {canSearch ? (
            <div className="topbar-search">
              <form
                className="global-search-form"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem('q');
                  const value = input instanceof HTMLInputElement ? input.value.trim() : '';
                  if (value) navigate('/search', { state: { query: value } });
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
          ) : null}
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
