import { describe, it, expect, beforeEach } from 'vitest';
import { UserRole } from '../types';
import { RBACService } from '../RBACService';

describe('RBACService', () => {
  let rbacService: RBACService;

  beforeEach(() => {
    rbacService = new RBACService();
  });

  describe('getPermissions', () => {
    it('should return user permissions for USER role', () => {
      const permissions = rbacService.getPermissions(UserRole.USER);
      expect(permissions).toContain('read:products');
      expect(permissions).toContain('read:orders');
    });

    it('should return moderator permissions for MODERATOR role', () => {
      const permissions = rbacService.getPermissions(UserRole.MODERATOR);
      expect(permissions).toContain('read:users');
      expect(permissions).toContain('manage:templates');
    });

    it('should return admin permissions for ADMIN role', () => {
      const permissions = rbacService.getPermissions(UserRole.ADMIN);
      expect(permissions).toContain('delete:products');
      expect(permissions).toContain('write:settings');
    });
  });

  describe('can', () => {
    it('should allow user to read products', () => {
      const result = rbacService.can(UserRole.USER, 'read', 'products');
      expect(result).toBe(true);
    });

    it('should deny user from deleting products', () => {
      const result = rbacService.can(UserRole.USER, 'delete', 'products');
      expect(result).toBe(false);
    });

    it('should allow moderator to manage templates', () => {
      const result = rbacService.can(UserRole.MODERATOR, 'manage', 'templates');
      expect(result).toBe(true);
    });

    it('should allow moderator to read products', () => {
      const result = rbacService.can(UserRole.MODERATOR, 'read', 'products');
      expect(result).toBe(true);
    });

    it('should deny moderator from managing settings', () => {
      const result = rbacService.can(UserRole.MODERATOR, 'manage', 'settings');
      expect(result).toBe(false);
    });

    it('should allow admin to delete products', () => {
      const result = rbacService.can(UserRole.ADMIN, 'delete', 'products');
      expect(result).toBe(true);
    });

    it('should allow admin debug requests permission', () => {
      const result = rbacService.can(UserRole.ADMIN, 'debug', 'requests');
      expect(result).toBe(true);
    });
  });

  describe('hasRole', () => {
    it('should return true for matching role', () => {
      const result = rbacService.hasRole(UserRole.ADMIN, UserRole.ADMIN);
      expect(result).toBe(true);
    });

    it('should return false for non-matching role', () => {
      const result = rbacService.hasRole(UserRole.USER, UserRole.ADMIN);
      expect(result).toBe(false);
    });
  });

  describe('canModerate', () => {
    it('should return true for MODERATOR role', () => {
      const result = rbacService.canModerate(UserRole.MODERATOR);
      expect(result).toBe(true);
    });

    it('should return true for ADMIN role', () => {
      const result = rbacService.canModerate(UserRole.ADMIN);
      expect(result).toBe(true);
    });

    it('should return false for USER role', () => {
      const result = rbacService.canModerate(UserRole.USER);
      expect(result).toBe(false);
    });
  });

  describe('permission inheritance', () => {
    it('moderators should include shared core permissions', () => {
      const modPerms = rbacService.getPermissions(UserRole.MODERATOR);

      expect(modPerms).toContain('read:products');
      expect(modPerms).toContain('read:orders');
      expect(modPerms).toContain('read:conversations');
    });

    it('admins should have all moderator permissions', () => {
      const modPerms = rbacService.getPermissions(UserRole.MODERATOR);
      const adminPerms = rbacService.getPermissions(UserRole.ADMIN);

      modPerms.forEach((perm) => {
        expect(adminPerms).toContain(perm);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle invalid action/resource combinations', () => {
      const result = rbacService.can(
        UserRole.ADMIN,
        'nonexistent',
        'nonexistent'
      );
      expect(result).toBe(false);
    });

    it('should handle empty permission checks', () => {
      const result = rbacService.can(UserRole.USER, '', '');
      expect(result).toBe(false);
    });
  });
});
