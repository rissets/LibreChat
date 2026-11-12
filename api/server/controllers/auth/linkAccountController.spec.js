jest.mock('mongoose', () => ({
  models: { Token: {} },
}), { virtual: true });

jest.mock('cookie', () => ({
  parse: (str) => {
    const res = {};
    if (!str) return res;
    str.split(';').forEach((p) => {
      const [k, ...v] = p.trim().split('=');
      if (k) res[k] = v.join('=');
    });
    return res;
  },
}), { virtual: true });

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'jwt-token'),
  decode: jest.fn(),
  verify: jest.fn(),
}), { virtual: true });

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  runAsSystem: jest.fn((fn) => fn()),
  tenantStorage: { run: jest.fn((_, fn) => fn()) },
}), { virtual: true });

jest.mock('@librechat/api', () => ({
  comparePassword: jest.fn(),
  compareSecret: jest.fn(),
  gatewayConfig: jest.fn().mockReturnValue(null),
  machineToken: jest.fn().mockResolvedValue('machine-token-abc'),
  resolveControlPanelBaseUrl: jest.fn().mockReturnValue('http://control-panel:8088'),
  createLocalAssertionToken: jest.fn().mockReturnValue('signed-assertion-jwt'),
  sanitizeUserForAuthResponse: jest.fn((u) => u),
  createResetPasswordController: jest.fn(),
  math: jest.fn((val, fallback) => fallback),
  isEnabled: jest.fn(),
  createAuthIdentityContext: jest.fn(),
  createOpenIDRefreshOwnershipError: jest.fn(),
  createOpenIDResponseDelivery: jest.fn(),
  isOpenIDRefreshOwnershipError: jest.fn(),
  isOpenIDSessionMissingError: jest.fn(),
  isOpenIDSessionIdentityMatch: jest.fn(),
  OPENID_EXPIRY_BUFFER_SECONDS: 30,
  clearCloudFrontCookies: jest.fn(),
  createLocalRefreshHandler: jest.fn(),
  generateTwoFactorSetupToken: jest.fn(),
  getValidOpenIDReuseCredential: jest.fn(),
  isTokenRetired: jest.fn(),
  isTwoFactorEnrollmentRequired: jest.fn(),
  getSafeErrorMetadata: jest.fn(),
  clearSessionHintCookie: jest.fn(),
  isManagedRefreshSessionValid: jest.fn(),
}), { virtual: true });

jest.mock('~/models', () => ({
  findUser: jest.fn(),
  updateUser: jest.fn(),
  deleteTokens: jest.fn(),
  getUserById: jest.fn(),
  findSession: jest.fn(),
  findToken: jest.fn(),
  deleteAllUserSessions: jest.fn(),
  deletePasskeysByUser: jest.fn(),
  awaitAuthUserDocEviction: jest.fn(),
  deleteSession: jest.fn(),
}), { virtual: true });

jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: jest.fn().mockResolvedValue('jwt-auth-token-123'),
  clearCloudFrontCookies: jest.fn(),
  setCloudFrontAuthCookies: jest.fn(),
  requestPasswordReset: jest.fn(),
  clearOpenIDAuthTokens: jest.fn(),
  resetPassword: jest.fn(),
  registerUser: jest.fn(),
}), { virtual: true });

jest.mock('~/server/services/GraphTokenService', () => ({
  getGraphApiToken: jest.fn(),
}), { virtual: true });

jest.mock('~/server/services/RefreshTokenBridge', () => ({
  getRefreshTokenBridge: jest.fn(),
}), { virtual: true });

jest.mock('~/server/services/OpenIDRefreshRecovery', () => ({
  recoverOpenIDRefreshBridge: jest.fn(),
  refreshOpenIDUser: jest.fn(),
  sendOpenIDAuthResponse: jest.fn(),
}), { virtual: true });
jest.mock('~/server/services/OpenIDRefreshFlight', () => ({
  acquireOpenIDRefreshFlight: jest.fn(),
  assertOpenIDRefreshFlightDeliveryAvailable: jest.fn(),
  assertOpenIDRefreshFlightAvailable: jest.fn(),
  assertOpenIDRefreshSessionGenerationAvailable: jest.fn(),
  claimOpenIDRefreshFlightDelivery: jest.fn(),
  completeOpenIDRefreshFlight: jest.fn(),
  createOpenIDRefreshFlightKey: jest.fn(),
  failOpenIDRefreshFlight: jest.fn(),
  releaseOpenIDRefreshFlightDelivery: jest.fn(),
  revokeOpenIDRefreshFlights: jest.fn(),
  waitForOpenIDRefreshFlight: jest.fn(),
  withOpenIDRefreshFlightLease: jest.fn(),
}), { virtual: true });

jest.mock('~/server/services/OpenIDSessionRefresh', () => ({
  refreshOpenIDSession: jest.fn(),
}), { virtual: true });

const mongoose = require('mongoose');
const { linkAccountController, linkChallengeStatusController } = require('~/server/controllers/AuthController');
const { findUser, updateUser } = require('~/models');
const { comparePassword } = require('@librechat/api');
const { setAuthTokens } = require('~/server/services/AuthService');
describe('linkAccountController (Local-SSO Account Linking)', () => {
  let mockRes;
  let mockFindOne;
  let mockFindOneAndDelete;
  let mockUpdateOne;
  let mockDeleteOne;

  beforeEach(() => {
    process.env.BPBATAM_LOCAL_ASSERTION_SECRET = 'test-secret';
    jest.clearAllMocks();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      clearCookie: jest.fn(),
    };
    mockFindOne = jest.fn();
    mockFindOneAndDelete = jest.fn();
    mockUpdateOne = jest.fn();
    mockDeleteOne = jest.fn();

    mongoose.models.Token = {
      findOne: mockFindOne,
      findOneAndDelete: mockFindOneAndDelete,
      updateOne: mockUpdateOne,
      deleteOne: mockDeleteOne,
    };
  });

  it('rejects request when password is missing', async () => {
    const req = {
      body: {},
      headers: {},
    };
    await linkAccountController(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Password is required' });
  });

  it('rejects request when link_challenge is missing', async () => {
    const req = {
      body: { password: 'mypassword' },
      headers: {},
    };
    await linkAccountController(req, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'LINK_CHALLENGE_REQUIRED' });
  });

  it('returns 400 when challenge token is invalid or expired', async () => {
    mockFindOne.mockResolvedValue(null);
    const req = {
      body: { password: 'mypassword' },
      headers: { cookie: 'link_challenge=test-token-abc' },
    };
    await linkAccountController(req, mockRes);

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'test-token-abc',
        type: 'account_linking',
        expiresAt: expect.any(Object),
      }),
    );
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'LINK_TOKEN_EXPIRED_OR_INVALID' });
    expect(mockRes.clearCookie).toHaveBeenCalledWith('link_challenge', { path: '/' });
  });

  it('allows retry on incorrect password and tracks remaining attempts without deleting token', async () => {
    mockFindOne.mockResolvedValue({
      _id: 'token-id-123',
      token: 'token-abc',
      userId: 'user-123',
      metadata: {
        attempts: 0,
      },
    });

    findUser.mockResolvedValue({
      _id: 'user-123',
      email: 'user@example.com',
      password: 'hashed-password',
      provider: 'local',
    });
    comparePassword.mockResolvedValue(false);

    const req = {
      body: { password: 'wrong-password' },
      headers: { cookie: 'link_challenge=token-abc' },
    };
    await linkAccountController(req, mockRes);

    expect(comparePassword).toHaveBeenCalled();
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'token-id-123' },
      { $set: { 'metadata.attempts': 1 } },
    );
    expect(mockDeleteOne).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'INCORRECT_PASSWORD',
        attemptsRemaining: 4,
      }),
    );
  });

  it('deletes token and locks out when max attempts (5) are exceeded', async () => {
    mockFindOne.mockResolvedValue({
      _id: 'token-id-123',
      token: 'token-abc',
      userId: 'user-123',
      metadata: {
        attempts: 4,
      },
    });

    findUser.mockResolvedValue({
      _id: 'user-123',
      email: 'user@example.com',
      password: 'hashed-password',
      provider: 'local',
    });
    comparePassword.mockResolvedValue(false);

    const req = {
      body: { password: 'wrong-password' },
      headers: { cookie: 'link_challenge=token-abc' },
    };
    await linkAccountController(req, mockRes);

    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'token-id-123' });
    expect(mockRes.clearCookie).toHaveBeenCalledWith('link_challenge', { path: '/' });
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'MAX_ATTEMPTS_EXCEEDED',
      }),
    );
  });

  it('prevents concurrent replay attacks on correct password: only one succeeds', async () => {
    mockFindOne.mockResolvedValue({
      _id: 'token-id-race',
      token: 'race-token',
      userId: 'user-123',
      metadata: {
        openidId: 'bpass-sub-456',
        openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
      },
    });

    let consumed = false;
    mockFindOneAndDelete.mockImplementation(() => ({
      lean: jest.fn().mockImplementation(async () => {
        if (!consumed) {
          consumed = true;
          return {
            _id: 'token-id-race',
            token: 'race-token',
            userId: 'user-123',
            metadata: {
              openidId: 'bpass-sub-456',
              openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
            },
          };
        }
        return null;
      }),
    }));

    findUser.mockResolvedValue({
      _id: 'user-123',
      email: 'user@example.com',
      password: 'hashed-password',
      provider: 'local',
      role: 'USER',
    });
    comparePassword.mockResolvedValue(true);
    updateUser.mockResolvedValue({
      _id: 'user-123',
      email: 'user@example.com',
      provider: 'local',
      password: 'hashed-password',
    });

    const req1 = {
      body: { password: 'correct-password' },
      headers: { cookie: 'link_challenge=race-token' },
    };
    const res1 = { status: jest.fn().mockReturnThis(), json: jest.fn(), clearCookie: jest.fn() };

    const req2 = {
      body: { password: 'correct-password' },
      headers: { cookie: 'link_challenge=race-token' },
    };
    const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn(), clearCookie: jest.fn() };

    // Fire concurrent calls
    await Promise.all([linkAccountController(req1, res1), linkAccountController(req2, res2)]);

    const statuses = [res1.status.mock.calls[0]?.[0], res2.status.mock.calls[0]?.[0]];
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);
  });
  it('fails closed when Control Panel is unavailable: preserves challenge token and does not update Mongo', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const { gatewayConfig } = require('@librechat/api');
    gatewayConfig.mockReturnValueOnce({
      endpoint: 'P0Router',
      fetch: mockFetch,
    });

    mockFindOne.mockResolvedValue({
      _id: 'token-id-cp-fail',
      token: 'cp-fail-token',
      userId: 'user-123',
      metadata: {
        openidId: 'sub-cp-fail',
        openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
      },
    });

    findUser.mockResolvedValue({
      _id: 'user-123',
      email: 'user@example.com',
      password: 'hashed-password',
      provider: 'local',
    });
    comparePassword.mockResolvedValue(true);

    const req = {
      body: { password: 'correct-password' },
      headers: { cookie: 'link_challenge=cp-fail-token' },
    };
    await linkAccountController(req, mockRes);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://control-panel:8088/api/v1/onboarding/link-identity',
      expect.objectContaining({
        body: JSON.stringify({ assertion: 'signed-assertion-jwt' }),
      }),
    );
    expect(mockFindOneAndDelete).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(mockRes.clearCookie).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'CONTROL_PANEL_UNAVAILABLE',
      }),
    );
  });

  it('links OpenID identity, keeps provider local, attaches user to req and issues session', async () => {
    mockFindOne.mockResolvedValue({
      _id: 'token-id-valid',
      token: 'valid-token',
      userId: 'user-123',
      metadata: {
        openidId: 'bpass-sub-789',
        openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
      },
    });

    mockFindOneAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'token-id-valid',
        token: 'valid-token',
        userId: 'user-123',
        metadata: {
          openidId: 'bpass-sub-789',
          openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
        },
      }),
    });

    const existingUser = {
      _id: 'user-123',
      email: 'user@example.com',
      password: 'hashed-password',
      provider: 'local',
      role: 'USER',
    };
    findUser.mockResolvedValue(existingUser);
    comparePassword.mockResolvedValue(true);
    updateUser.mockResolvedValue({ ...existingUser, openidId: 'bpass-sub-789' });

    const req = {
      body: { password: 'correct-password' },
      headers: { cookie: 'link_challenge=valid-token' },
    };
    await linkAccountController(req, mockRes);

    expect(updateUser).toHaveBeenCalledWith('user-123', {
      openidId: 'bpass-sub-789',
      openidIssuer: 'https://sso-dev.bpbatam.go.id/application/o/devai/',
    });
    // Verifies req.user is attached to req when calling setAuthTokens to satisfy managedSessionOptions
    expect(setAuthTokens).toHaveBeenCalledWith(
      'user-123',
      mockRes,
      null,
      expect.objectContaining({ user: expect.objectContaining({ provider: 'local' }) }),
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'LINK_SUCCESS',
        token: 'jwt-auth-token-123',
      }),
    );
  });
});
