/**
 * UsersPage Component
 * Admin-only page for managing users with permission-gated CRUD actions
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/hooks';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { DisableIfNoPermission, PermissionGate } from '@/shared/components/guards';
import { useUsersApi } from '../api/useUsersApi';
import { User, CreateUserInput, UpdateUserInput } from '../types';
import UsersTable from './UsersTable';
import CreateUserModal from './CreateUserModal';
import EditUserModal from './EditUserModal';

export default function UsersPage() {
  const { user, isAuthenticated, isLoading: authLoading, currentShop } = useAuth();
  const { hasRole } = useUserPermissions();
  const { users, isLoading, error, listUsers, createUser, updateUser, deleteUser, clearError } = useUsersApi();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Check authorization
  const isAdmin = hasRole('admin');

  // Load users on mount and when shop changes
  useEffect(() => {
    if (isAuthenticated && currentShop) {
      listUsers();
    }
  }, [isAuthenticated, currentShop?.id, listUsers]);

  // Authorization checks
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" role="progressbar" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800 font-semibold">Please sign in to access this page</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-800 font-semibold">Unauthorized: You do not have permission to manage users</p>
      </div>
    );
  }

  const handleCreateUser = async (input: CreateUserInput) => {
    await createUser(input);
    setShowCreateModal(false);
  };

  const handleEditUser = async (userId: string, input: UpdateUserInput) => {
    await updateUser(userId, input);
    setShowEditModal(false);
    setSelectedUser(null);
  };

  const handleDeleteUser = async (userId: string) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      await deleteUser(userId);
    }
  };

  const handleEditClick = (user: User) => {
    setSelectedUser(user);
    setShowEditModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Users Management</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage system users and their permissions for {currentShop?.name}
          </p>
        </div>

        {/* Create User Button */}
        <DisableIfNoPermission action="write" resource="users">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create User
          </button>
        </DisableIfNoPermission>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-center">
            <p className="text-red-800">{error}</p>
            <button
              onClick={clearError}
              className="text-red-600 hover:text-red-800 font-semibold"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      )}

      {/* Users Table */}
      {!isLoading && (
        <UsersTable
          users={users}
          onEdit={handleEditClick}
          onDelete={handleDeleteUser}
        />
      )}

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateUser}
      />

      {/* Edit User Modal */}
      {selectedUser && (
        <EditUserModal
          isOpen={showEditModal}
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onSuccess={(userId, input) => handleEditUser(userId, input)}
        />
      )}
    </div>
  );
}
