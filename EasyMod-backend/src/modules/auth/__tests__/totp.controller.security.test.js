'use strict';

const mockUser = {
  id: 'user-1',
  email: 'merchant@example.com',
  token_version: 4,
  last_logged_shop_id: 'stale-shop',
  shops: [{ id: 'active-shop', UserShop: { role: 'owner', is_active: true } }],
  update: jest.fn().mockResolvedValue(),
};

jest.mock('../totp.service', () => ({
  consumeTempTokenDetails: jest.fn(),
  verifyTotpToken: jest.fn(),
}));
jest.mock('../auth.service', () => ({
  getTemporaryPasswordAuthData: jest.fn(() => null),
  hasActiveGrowthOsRole: jest.fn(),
  getActiveGrowthOsRole: jest.fn(),
}));
jest.mock('../../entities', () => ({
  User: { findByPk: jest.fn() },
  Shop: {},
}));
jest.mock('../../../utils/jwt.util', () => ({
  generateAccessToken: jest.fn(() => 'access-token'),
  generateRefreshToken: jest.fn(() => 'refresh-token'),
}));
jest.mock('../../../utils/auth-cookies', () => ({ setAuthCookies: jest.fn() }));

const totpService = require('../totp.service');
const authService = require('../auth.service');
const { User } = require('../../entities');
const { generateAccessToken } = require('../../../utils/jwt.util');
const controller = require('../totp.controller');

describe('TOTP shop-context security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    totpService.consumeTempTokenDetails.mockResolvedValue({ userId: mockUser.id, tokenVersion: mockUser.token_version });
    totpService.verifyTotpToken.mockResolvedValue(true);
    authService.getActiveGrowthOsRole.mockResolvedValue(null);
    User.findByPk.mockResolvedValue(mockUser);
  });

  it('resolves an active shop instead of trusting a stale merchant shop id', async () => {
    const req = { body: { tempToken: 'temp-token', token: '123456' }, get: jest.fn() };
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await controller.verify(req, res, next);

    expect(generateAccessToken).toHaveBeenCalledWith(expect.objectContaining({ shopId: 'active-shop' }));
    expect(mockUser.update).toHaveBeenCalledWith({ last_logged_shop_id: 'active-shop' });
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps a Growth OS user out of merchant sessions even with an old membership', async () => {
    authService.getActiveGrowthOsRole.mockResolvedValue({ id: 'growth-role' });
    const req = { body: { tempToken: 'temp-token', token: '123456' }, get: jest.fn() };
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await controller.verify(req, res, next);

    expect(generateAccessToken).toHaveBeenCalledWith(expect.objectContaining({ shopId: null }));
    expect(mockUser.update).toHaveBeenCalledWith({ last_logged_shop_id: null });
    expect(next).not.toHaveBeenCalled();
  });
});
