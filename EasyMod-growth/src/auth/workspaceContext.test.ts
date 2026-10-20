import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_CONTEXT_STORAGE_KEY,
  hasAdminContext,
  persistWorkspaceContext,
  resolveWorkspaceContext,
} from './workspaceContext';

const ADMIN = ['growth_os.session.read', 'growth_os.admin.operations.read'];
const SALES = ['growth_os.session.read', 'growth_os.prospects.read_all'];

describe('workspaceContext', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('only treats admin-side grants as the admin context', () => {
    expect(hasAdminContext(ADMIN)).toBe(true);
    expect(hasAdminContext(SALES)).toBe(false);
  });

  it('defaults SUPER_ADMIN-like sessions to Admin Control and GROWTH_USER-like sessions to Sales', () => {
    expect(resolveWorkspaceContext(ADMIN)).toBe('admin');
    expect(resolveWorkspaceContext(SALES)).toBe('sales');
  });

  it('honors a stored preference for admin-capable sessions', () => {
    persistWorkspaceContext('sales');
    expect(window.sessionStorage.getItem(WORKSPACE_CONTEXT_STORAGE_KEY)).toBe('sales');
    expect(resolveWorkspaceContext(ADMIN)).toBe('sales');
  });

  it('ignores a stored admin preference when permissions do not cover it', () => {
    window.sessionStorage.setItem(WORKSPACE_CONTEXT_STORAGE_KEY, 'admin');
    expect(resolveWorkspaceContext(SALES)).toBe('sales');
  });

  it('ignores garbage stored values', () => {
    window.sessionStorage.setItem(WORKSPACE_CONTEXT_STORAGE_KEY, 'super-admin-please');
    expect(resolveWorkspaceContext(ADMIN)).toBe('admin');
  });
});
