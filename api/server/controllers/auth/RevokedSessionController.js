const { runAsSystem } = require('@librechat/data-schemas');
const { getUserById } = require('~/models');
const { getOpenIdConfig } = require('~/strategies');

/** The signed server session identifies the browser even after its application user is deleted. */
const revokedSessionController = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (process.env.BPBATAM_AUTO_SLO_ON_REVOCATION !== 'true') return res.status(204).end();
  const session = req.session?.openidTokens ?? req.session?.revokedLogout;
  if (!session?.appUserId || !session?.openidSubject || session.openidIssuer !== process.env.OPENID_ISSUER) {
    return res.status(204).end();
  }
  try {
    const user = await runAsSystem(() => getUserById(session.appUserId));
    if (user && !user.governanceDisabled) return res.status(204).end();
    const upstream = req.session.bpassLogin && process.env.BPBATAM_BPASS_LOGOUT_URL;
    const logoutUrl = upstream || getOpenIdConfig()?.serverMetadata()?.end_session_endpoint;
    if (!logoutUrl) return res.status(503).json({ code: 'UPSTREAM_LOGOUT_UNAVAILABLE' });
    const url = new URL(logoutUrl);
    if (url.protocol !== 'https:' && (upstream || url.protocol !== 'http:')) {
      return res.status(503).json({ code: 'UPSTREAM_LOGOUT_UNAVAILABLE' });
    }
    if (!upstream && session.idToken) url.searchParams.set('id_token_hint', session.idToken);
    if (!upstream && process.env.OPENID_POST_LOGOUT_REDIRECT_URI) {
      url.searchParams.set('post_logout_redirect_uri', process.env.OPENID_POST_LOGOUT_REDIRECT_URI);
    }
    await new Promise((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    for (const name of ['connect.sid', 'refreshToken', 'openid_access_token', 'openid_id_token', 'openid_user_id', 'token_provider']) {
      res.clearCookie(name);
    }
    return res.json({ redirect: url.toString() });
  } catch {
    return res.status(503).json({ code: 'SESSION_CHECK_UNAVAILABLE' });
  }
};

module.exports = { revokedSessionController };
