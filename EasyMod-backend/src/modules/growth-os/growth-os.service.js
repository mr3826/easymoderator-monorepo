'use strict';

const repository = require('./growth-os.repository');
const { AppError } = require('../../utils/AppError');

async function getSession(userId, growthOsAccess) {
  let user;
  try {
    user = await repository.findSafeUserProfile(userId);
  } catch (_error) {
    throw new AppError(
      'Growth OS profile service is temporarily unavailable.',
      503,
      'GROWTH_OS_PROFILE_UNAVAILABLE',
    );
  }

  if (!user) {
    throw new AppError('Growth OS user context is unavailable.', 403, 'GROWTH_OS_FORBIDDEN');
  }

  return {
    internalUserId: user.id,
    displayName: user.full_name || 'Internal user',
    role: growthOsAccess.role,
    permissions: growthOsAccess.permissions,
  };
}

module.exports = {
  getSession,
};
