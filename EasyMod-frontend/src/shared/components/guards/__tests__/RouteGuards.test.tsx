import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AdminRoute, ModeratorRoute, PermissionRoute, withRouteGuard } from '../RouteGuards';
import { useAuth } from '@/features/auth/hooks';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { UserRole } from '@/shared/lib/rbac/types';

// Mock hooks
vi.mock('@/features/auth/hooks');
vi.mock('@/shared/lib/rbac/useUserPermissions');
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const mockUseAuth = useAuth as any;
const mockUseUserPermissions = useUserPermissions as any;

describe('AdminRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children when user is authenticated admin', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.ADMIN },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => role === UserRole.ADMIN,
    });

    render(
      <BrowserRouter>
        <AdminRoute>
          <div>Admin Panel</div>
        </AdminRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('should show loading screen while loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });

    render(
      <BrowserRouter>
        <AdminRoute>
          <div>Admin Panel</div>
        </AdminRoute>
      </BrowserRouter>
    );

    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('should hide content from non-admin users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    render(
      <BrowserRouter>
        <AdminRoute>
          <div>Admin Panel</div>
        </AdminRoute>
      </BrowserRouter>
    );

    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    // Should show unauthorized screen
    expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument();
  });

  it('should support custom redirect URL', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    render(
      <BrowserRouter>
        <AdminRoute redirectTo="/custom-page">
          <div>Admin Panel</div>
        </AdminRoute>
      </BrowserRouter>
    );

    expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument();
  });
});

describe('ModeratorRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children for moderators', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.MODERATOR },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      canModerate: () => true,
    });

    render(
      <BrowserRouter>
        <ModeratorRoute>
          <div>Moderation Panel</div>
        </ModeratorRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Moderation Panel')).toBeInTheDocument();
  });

  it('should render children for admins (who can also moderate)', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.ADMIN },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      canModerate: () => true,
    });

    render(
      <BrowserRouter>
        <ModeratorRoute>
          <div>Moderation Panel</div>
        </ModeratorRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Moderation Panel')).toBeInTheDocument();
  });

  it('should hide from non-moderator users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      canModerate: () => false,
    });

    render(
      <BrowserRouter>
        <ModeratorRoute>
          <div>Moderation Panel</div>
        </ModeratorRoute>
      </BrowserRouter>
    );

    expect(screen.queryByText('Moderation Panel')).not.toBeInTheDocument();
  });
});

describe('PermissionRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children when user has permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.ADMIN },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => true,
    });

    render(
      <BrowserRouter>
        <PermissionRoute action="read" resource="reports">
          <div>Reports Page</div>
        </PermissionRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Reports Page')).toBeInTheDocument();
  });

  it('should hide content when user lacks permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    render(
      <BrowserRouter>
        <PermissionRoute action="read" resource="reports">
          <div>Reports Page</div>
        </PermissionRoute>
      </BrowserRouter>
    );

    expect(screen.queryByText('Reports Page')).not.toBeInTheDocument();
  });

  it('should support custom redirect', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    render(
      <BrowserRouter>
        <PermissionRoute
          action="read"
          resource="reports"
          redirectTo="/no-access"
        >
          <div>Reports Page</div>
        </PermissionRoute>
      </BrowserRouter>
    );

    expect(screen.queryByText('Reports Page')).not.toBeInTheDocument();
  });
});

describe('withRouteGuard HOC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render wrapped component for authorized users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.ADMIN },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => role === UserRole.ADMIN,
    });

    const TestComponent = () => <div>Protected Content</div>;
    const ProtectedComponent = withRouteGuard(TestComponent, {
      requiredRole: UserRole.ADMIN,
    });

    render(
      <BrowserRouter>
        <ProtectedComponent />
      </BrowserRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should redirect unauthorized users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.USER },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    const TestComponent = () => <div>Protected Content</div>;
    const ProtectedComponent = withRouteGuard(TestComponent, {
      requiredRole: UserRole.ADMIN,
      redirectTo: '/dashboard',
    });

    render(
      <BrowserRouter>
        <ProtectedComponent />
      </BrowserRouter>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should check permissions when specified', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1', role: UserRole.ADMIN },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => true,
    });

    const TestComponent = () => <div>Permission Protected</div>;
    const ProtectedComponent = withRouteGuard(TestComponent, {
      requiredAction: 'read',
      requiredResource: 'reports',
    });

    render(
      <BrowserRouter>
        <ProtectedComponent />
      </BrowserRouter>
    );

    expect(screen.getByText('Permission Protected')).toBeInTheDocument();
  });

  it('should show loading while authenticating', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });

    const TestComponent = () => <div>Protected Content</div>;
    const ProtectedComponent = withRouteGuard(TestComponent, {
      requiredRole: UserRole.ADMIN,
    });

    render(
      <BrowserRouter>
        <ProtectedComponent />
      </BrowserRouter>
    );

    // Should show loading indicator, not content
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});
