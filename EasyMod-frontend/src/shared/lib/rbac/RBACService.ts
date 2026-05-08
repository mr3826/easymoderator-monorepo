import { UserRole, Permission, PERMISSION_MATRIX } from './types';

export class RBACService {
  getPermissions(role: UserRole): Permission[] {
    return PERMISSION_MATRIX[role] ?? [];
  }

  can(role: UserRole, action: string, resource: string): boolean {
    const permissions = this.getPermissions(role);

    return permissions.some((permission) => {
      const [permAction, permResource] = permission.split(':');
      const actionMatch = permAction === '*' || permAction === action;
      const resourceMatch = permResource === '*' || permResource === resource;
      return actionMatch && resourceMatch;
    });
  }

  hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
    return userRole === requiredRole;
  }

  canModerate(role: UserRole): boolean {
    return role === UserRole.MODERATOR || role === UserRole.ADMIN;
  }
}
