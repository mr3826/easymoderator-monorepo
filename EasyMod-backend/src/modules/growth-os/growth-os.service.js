'use strict';

const repository = require('./growth-os.repository');

async function getSession(userId, growthOsAccess) {
  const user = await repository.findSafeUserProfile(userId);

  return {
    internalUserId: user?.id || userId,
    displayName: user?.full_name || 'Internal user',
    role: growthOsAccess.role,
    permissions: growthOsAccess.permissions,
  };
}

module.exports = {
  getSession,
};
