jest.mock('@librechat/data-schemas', () => ({ runAsSystem: (fn) => fn() }));
jest.mock('~/models', () => ({ getUserById: jest.fn() }));
jest.mock('~/strategies', () => ({ getOpenIdConfig: jest.fn() }));
const { getUserById } = require('~/models');
const { getOpenIdConfig } = require('~/strategies');
const { revokedSessionController } = require('./RevokedSessionController');

beforeEach(() => {
  process.env.OPENID_ISSUER = 'https://issuer.test';
  process.env.OPENID_POST_LOGOUT_REDIRECT_URI = 'https://app.test/login';
  getOpenIdConfig.mockReturnValue({ serverMetadata: () => ({ end_session_endpoint: 'https://issuer.test/logout' }) });
  process.env.BPBATAM_AUTO_SLO_ON_REVOCATION = 'true';
});
afterEach(() => jest.clearAllMocks());

function request() {
  return { session: { openidTokens: { appUserId: 'user', openidSubject: 'sub', openidIssuer: 'https://issuer.test', idToken: 'signed-token' }, destroy: jest.fn((cb) => cb()) } };
}
function response() {
  return { set: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn(), json: jest.fn(), clearCookie: jest.fn() };
}
it('preserves an active session', async () => {
  getUserById.mockResolvedValue({ governanceDisabled: false });
  const req = request(), res = response();
  await revokedSessionController(req, res);
  expect(res.status).toHaveBeenCalledWith(204);
  expect(req.session.destroy).not.toHaveBeenCalled();
});
it.each([null, { governanceDisabled: true }])('logs out a deleted or disabled account', async (user) => {
  getUserById.mockResolvedValue(user);
  const req = request(), res = response();
  await revokedSessionController(req, res);
  expect(req.session.destroy).toHaveBeenCalledTimes(1);
  const url = new URL(res.json.mock.calls[0][0].redirect);
  expect(url.origin + url.pathname).toBe('https://issuer.test/logout');
  expect(url.searchParams.get('id_token_hint')).toBe('signed-token');
  expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.test/login');
});

it('can redirect after refresh credentials have already been cleared', async () => {
  getUserById.mockResolvedValue(null);
  const req = request(), res = response();
  req.session.revokedLogout = req.session.openidTokens;
  delete req.session.openidTokens;
  await revokedSessionController(req, res);
  expect(req.session.destroy).toHaveBeenCalledTimes(1);
  expect(new URL(res.json.mock.calls[0][0].redirect).searchParams.get('id_token_hint')).toBe('signed-token');
});

it('uses the configured B-Pass logout flow only for B-Pass sessions', async () => {
  getUserById.mockResolvedValue(null);
  process.env.BPBATAM_BPASS_LOGOUT_URL = 'https://bpass.test/logout';
  const req = request(), res = response();
  req.session.bpassLogin = true;
  await revokedSessionController(req, res);
  expect(res.json).toHaveBeenCalledWith({ redirect: 'https://bpass.test/logout' });
  delete process.env.BPBATAM_BPASS_LOGOUT_URL;
});

it('does not log out on a database failure', async () => {
  getUserById.mockRejectedValue(new Error('database down'));
  const req = request(), res = response();
  await revokedSessionController(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(req.session.destroy).not.toHaveBeenCalled();
});
