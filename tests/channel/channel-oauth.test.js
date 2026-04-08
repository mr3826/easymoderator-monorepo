const request = require('supertest');
const express = require('express');

jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      userId: 'user-1',
      shopId: 'shop-1'
    };
    next();
  }
}));

jest.mock('../../src/modules/channel/channel.oauth.service', () => ({
  initiateOAuth: jest.fn(),
  handleCallback: jest.fn(),
  connectPage: jest.fn()
}));

const oauthService = require('../../src/modules/channel/channel.oauth.service');
const channelRoutes = require('../../src/modules/channel/channel.routes');

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/channel', channelRoutes);
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({
      success: false,
      error: { message: err.message }
    });
  });
  return app;
};

describe('Channel OAuth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /channel/oauth/initiate returns redirect URL and state', async () => {
    oauthService.initiateOAuth.mockResolvedValue({
      redirectUrl: 'https://facebook.com/oauth',
      state: 'x'.repeat(64)
    });

    const res = await request(createApp())
      .post('/channel/oauth/initiate')
      .send({ channelType: 'facebook' });

    expect(res.status).toBe(200);
    expect(oauthService.initiateOAuth).toHaveBeenCalledWith('user-1', 'shop-1', 'facebook');
    expect(res.body.success).toBe(true);
    expect(res.body.data.redirectUrl).toContain('facebook.com');
  });

  test('POST /channel/oauth/initiate rejects unsupported channelType', async () => {
    const res = await request(createApp())
      .post('/channel/oauth/initiate')
      .send({ channelType: 'whatsapp' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(oauthService.initiateOAuth).not.toHaveBeenCalled();
  });

  test('POST /channel/oauth/callback returns pages and temp token', async () => {
    oauthService.handleCallback.mockResolvedValue({
      pages: [{ id: '123', name: 'Demo Page' }],
      tempToken: 't'.repeat(64)
    });

    const res = await request(createApp())
      .post('/channel/oauth/callback')
      .send({
        code: 'oauth-code-1234567890',
        state: 's'.repeat(64)
      });

    expect(res.status).toBe(200);
    expect(oauthService.handleCallback).toHaveBeenCalledWith(
      'oauth-code-1234567890',
      's'.repeat(64),
      'user-1',
      'shop-1'
    );
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.pages)).toBe(true);
  });

  test('POST /channel/oauth/connect-page forwards validated payload', async () => {
    oauthService.connectPage.mockResolvedValue({
      id: 'channel-1',
      channel_type: 'facebook',
      page_id: 'page-1'
    });

    const res = await request(createApp())
      .post('/channel/oauth/connect-page')
      .send({
        pageId: 'page-1',
        pageName: 'My Page',
        tempToken: 'z'.repeat(64)
      });

    expect(res.status).toBe(200);
    expect(oauthService.connectPage).toHaveBeenCalledWith(
      'page-1',
      'My Page',
      'z'.repeat(64),
      'user-1',
      'shop-1'
    );
    expect(res.body.success).toBe(true);
  });

  test('POST /channel/oauth/connect-page rejects invalid tempToken', async () => {
    const res = await request(createApp())
      .post('/channel/oauth/connect-page')
      .send({
        pageId: 'page-1',
        pageName: 'My Page',
        tempToken: 'short-token'
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(oauthService.connectPage).not.toHaveBeenCalled();
  });
});
