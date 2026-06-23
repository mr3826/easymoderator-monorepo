'use strict';

const platformRoleHolder = { value: null };
const mockRetry = jest.fn(async () => {});
const mockRemove = jest.fn(async () => {});

jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { userId: 'admin-1', email: 'a@x.io' }; next(); },
}));

jest.mock('../../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
}));

jest.mock('../../entities', () => ({
  User: { findByPk: jest.fn(async () => ({ platform_role: platformRoleHolder.value })) },
}));

jest.mock('../../../jobs/message-queue', () => ({
  messageQueue: {
    getFailed: jest.fn(async () => [{ id: 'job-1', data: {}, retry: mockRetry, remove: mockRemove }]),
    getFailedCount: jest.fn(async () => 1),
  },
}));

const express = require('express');
const request = require('supertest');
const failedJobsRoutes = require('../failed-jobs.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/failed-jobs', failedJobsRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('failed jobs admin authorization', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    platformRoleHolder.value = null;
    mockRetry.mockClear();
    mockRemove.mockClear();
  });

  it('allows SUPPORT_ADMIN to list failed jobs', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';

    const res = await request(app).get('/api/admin/failed-jobs');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  it('blocks SUPPORT_ADMIN from retrying a failed job', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';

    const res = await request(app).post('/api/admin/failed-jobs/job-1/retry');

    expect(res.status).toBe(403);
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('blocks SUPPORT_ADMIN from deleting a failed job', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';

    const res = await request(app).delete('/api/admin/failed-jobs/job-1');

    expect(res.status).toBe(403);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN to retry and delete failed jobs', async () => {
    platformRoleHolder.value = 'SUPER_ADMIN';

    const retryRes = await request(app).post('/api/admin/failed-jobs/job-1/retry');
    const deleteRes = await request(app).delete('/api/admin/failed-jobs/job-1');

    expect(retryRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
