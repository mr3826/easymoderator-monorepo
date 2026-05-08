import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionGate, RoleGate, AdminGate, ModeratorGate, DisableIfNoPermission } from '../PermissionGate';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { UserRole } from '@/shared/lib/rbac/types';

// Mock useUserPermissions
vi.mock('@/shared/lib/rbac/useUserPermissions');

describe('PermissionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children when user has permission', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => true,
    });

    render(
      <PermissionGate action="delete" resource="products">
        <button>Delete</button>
      </PermissionGate>
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('should not render children when user lacks permission', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    render(
      <PermissionGate action="delete" resource="products">
        <button>Delete</button>
      </PermissionGate>
    );

    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('should render fallback when user lacks permission', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    render(
      <PermissionGate
        action="delete"
        resource="products"
        fallback={<div>No permission</div>}
      >
        <button>Delete</button>
      </PermissionGate>
    );

    expect(screen.getByText('No permission')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('should render null fallback by default', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    const { container } = render(
      <PermissionGate action="delete" resource="products">
        <button>Delete</button>
      </PermissionGate>
    );

    expect(container.childNodes.length).toBe(0);
  });
});

describe('RoleGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children when user has required role', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => role === UserRole.ADMIN,
    });

    render(
      <RoleGate role={UserRole.ADMIN}>
        <div>Admin Content</div>
      </RoleGate>
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
  });

  it('should not render children when user lacks required role', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    render(
      <RoleGate role={UserRole.ADMIN}>
        <div>Admin Content</div>
      </RoleGate>
    );

    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('should render children when user has any of multiple roles', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => role === UserRole.MODERATOR,
    });

    render(
      <RoleGate role={[UserRole.ADMIN, UserRole.MODERATOR]}>
        <div>Staff Content</div>
      </RoleGate>
    );

    expect(screen.getByText('Staff Content')).toBeInTheDocument();
  });

  it('should support fallback UI', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    render(
      <RoleGate
        role={UserRole.ADMIN}
        fallback={<div>Not authorized</div>}
      >
        <div>Admin Content</div>
      </RoleGate>
    );

    expect(screen.getByText('Not authorized')).toBeInTheDocument();
  });
});

describe('AdminGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children for admin users', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => role === UserRole.ADMIN,
    });

    render(
      <AdminGate>
        <div>Admin Panel</div>
      </AdminGate>
    );

    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('should not render for non-admin users', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      hasRole: (role: UserRole) => false,
    });

    render(
      <AdminGate>
        <div>Admin Panel</div>
      </AdminGate>
    );

    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});

describe('ModeratorGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children for moderators', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      canModerate: () => true,
    });

    render(
      <ModeratorGate>
        <div>Moderation Queue</div>
      </ModeratorGate>
    );

    expect(screen.getByText('Moderation Queue')).toBeInTheDocument();
  });

  it('should not render for non-moderators', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      canModerate: () => false,
    });

    render(
      <ModeratorGate>
        <div>Moderation Queue</div>
      </ModeratorGate>
    );

    expect(screen.queryByText('Moderation Queue')).not.toBeInTheDocument();
  });
});

describe('DisableIfNoPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render enabled button when user has permission', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => true,
    });

    render(
      <DisableIfNoPermission action="delete" resource="products">
        <button>Delete</button>
      </DisableIfNoPermission>
    );

    const button = screen.getByText('Delete') as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    expect(button.disabled).toBe(false);
  });

  it('should render disabled button when user lacks permission', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    render(
      <DisableIfNoPermission action="delete" resource="products">
        <button>Delete</button>
      </DisableIfNoPermission>
    );

    const button = screen.getByText('Delete') as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    expect(button.disabled).toBe(true);
  });

  it('should apply opacity-50 and cursor-not-allowed classes when disabled', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    const { container } = render(
      <DisableIfNoPermission action="delete" resource="products">
        <button className="btn">Delete</button>
      </DisableIfNoPermission>
    );

    const button = container.querySelector('button');
    expect(button?.className).toMatch(/opacity-50/);
    expect(button?.className).toMatch(/cursor-not-allowed/);
  });

  it('should show tooltip on hover', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    const { container } = render(
      <DisableIfNoPermission
        action="delete"
        resource="products"
        tooltip="Admins only"
      >
        <button>Delete</button>
      </DisableIfNoPermission>
    );

    const wrapper = container.querySelector('div[title]');
    expect(wrapper).toHaveAttribute('title', 'Admins only');
  });

  it('should show default tooltip if not provided', () => {
    const mockUseUserPermissions = useUserPermissions as any;
    mockUseUserPermissions.mockReturnValue({
      can: (action: string, resource: string) => false,
    });

    const { container } = render(
      <DisableIfNoPermission action="delete" resource="products">
        <button>Delete</button>
      </DisableIfNoPermission>
    );

    const wrapper = container.querySelector('div[title]');
    expect(wrapper).toHaveAttribute(
      'title',
      "You don't have permission to delete products"
    );
  });
});
