// Single-user OAuth 2.1 provider for claude.ai custom-connector compatibility.
//
// Why: claude.ai remote MCP connectors authenticate ONLY via OAuth (no static-bearer
// field). The MCP Node SDK ships the whole OAuth toolkit (mcpAuthRouter + DCR + PKCE +
// token/authorize/register handlers); this provides the single-user backing logic.
//
// Design:
//  - Consent gate: the /authorize step renders a password page (OAUTH_LOGIN_PASSWORD).
//    Only the correct password mints an authorization code → only Paolo can authorize a
//    client, so the budget-touching endpoint stays private even though DCR is open.
//  - Stateless tokens: access/refresh/codes are HMAC-signed (OAUTH_SIGNING_SECRET), so
//    issued access tokens KEEP WORKING across Railway redeploys (no Redis/volume needed).
//    DCR clients live in-memory (re-registered transparently by claude.ai if a redeploy
//    wipes them; access tokens already in hand keep calling /mcp regardless).

import crypto from 'crypto';

const SECRET = process.env.OAUTH_SIGNING_SECRET || '';
const LOGIN_PASSWORD = process.env.OAUTH_LOGIN_PASSWORD || '';
const ACCESS_TTL = parseInt(process.env.OAUTH_ACCESS_TTL_SEC || '2592000', 10); // 30 days
const REFRESH_TTL = parseInt(process.env.OAUTH_REFRESH_TTL_SEC || '31536000', 10); // 1 year
const CODE_TTL = 300; // 5 minutes

export function oauthEnabled() {
  return Boolean(SECRET && LOGIN_PASSWORD);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadObj, ttlSec, type) {
  const payload = { ...payloadObj, type, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifySigned(token, type) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(body).digest());
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p.type !== type) return null;
  if (p.exp && Math.floor(Date.now() / 1000) > p.exp) return null;
  return p;
}

// ─── In-memory DCR client store ───
const clients = new Map();

class ClientsStore {
  getClient(clientId) { return clients.get(clientId); }
  registerClient(client) {
    const client_id = 'gorgias_' + crypto.randomBytes(16).toString('hex');
    const full = { ...client, client_id, client_id_issued_at: Math.floor(Date.now() / 1000) };
    clients.set(client_id, full);
    return full;
  }
}

function renderConsent(qs, error) {
  const errHtml = error ? `<p style="color:#c0392b;margin:0 0 12px">${error}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gorgias MCP — Authorize</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<form method="POST" action="/oauth/consent" style="background:#1a1d24;padding:32px;border-radius:14px;width:340px;box-shadow:0 8px 30px rgba(0,0,0,.4)">
<h2 style="margin:0 0 6px">Gorgias MCP</h2>
<p style="margin:0 0 18px;color:#9aa0aa;font-size:14px">Authorize this connection. Enter the access password.</p>
${errHtml}
<input type="password" name="password" placeholder="Access password" autofocus required
 style="width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid #2c313c;background:#0f1115;color:#fff;margin:0 0 14px">
<input type="hidden" name="oauth" value="${qs.replace(/"/g, '&quot;')}">
<button type="submit" style="width:100%;padding:11px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer">Authorize</button>
</form></body></html>`;
}

export class GorgiasOAuthProvider {
  constructor() { this._store = new ClientsStore(); }
  get clientsStore() { return this._store; }

  // The SDK authorize handler validated client + redirect_uri already. Render the
  // password gate; the form POSTs to /oauth/consent which mints the code on success.
  async authorize(client, params, res) {
    const qs = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      ...(params.state ? { state: params.state } : {}),
      ...(params.scopes && params.scopes.length ? { scope: params.scopes.join(' ') } : {}),
      ...(params.resource ? { resource: params.resource.toString() } : {}),
    }).toString();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderConsent(qs, null));
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const p = verifySigned(authorizationCode, 'code');
    if (!p || p.client_id !== client.client_id) throw new Error('invalid_grant: authorization code');
    return p.code_challenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode /*, codeVerifier, redirectUri, resource */) {
    const p = verifySigned(authorizationCode, 'code');
    if (!p || p.client_id !== client.client_id) throw new Error('invalid_grant: authorization code');
    return this._issueTokens(client.client_id, (p.scope || '').split(' ').filter(Boolean));
  }

  async exchangeRefreshToken(client, refreshToken, scopes /*, resource */) {
    const p = verifySigned(refreshToken, 'refresh');
    if (!p || p.client_id !== client.client_id) throw new Error('invalid_grant: refresh token');
    const useScopes = (scopes && scopes.length) ? scopes : (p.scope || '').split(' ').filter(Boolean);
    return this._issueTokens(client.client_id, useScopes);
  }

  _issueTokens(clientId, scopes) {
    const scope = (scopes || []).join(' ');
    const access_token = sign({ client_id: clientId, scope }, ACCESS_TTL, 'access');
    const refresh_token = sign({ client_id: clientId, scope }, REFRESH_TTL, 'refresh');
    return { access_token, token_type: 'bearer', expires_in: ACCESS_TTL, refresh_token, ...(scope ? { scope } : {}) };
  }

  async verifyAccessToken(token) {
    const p = verifySigned(token, 'access');
    if (!p) throw new Error('invalid_token');
    // resource intentionally omitted from AuthInfo to avoid strict RFC8707 mismatch rejects.
    return { token, clientId: p.client_id, scopes: (p.scope || '').split(' ').filter(Boolean), expiresAt: p.exp };
  }
}

// POST /oauth/consent — password gate that mints the authorization code and redirects back.
export function makeConsentHandler(provider) {
  return async (req, res) => {
    const oauth = req.body && req.body.oauth ? req.body.oauth : '';
    const params = new URLSearchParams(oauth);
    const client_id = params.get('client_id');
    const redirect_uri = params.get('redirect_uri');
    const code_challenge = params.get('code_challenge');
    const state = params.get('state');
    const scope = params.get('scope') || '';

    const fail = (msg, code = 401) => {
      res.status(code).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderConsent(oauth, msg));
    };

    if (!LOGIN_PASSWORD || !req.body || req.body.password !== LOGIN_PASSWORD) {
      return fail('Wrong password. Try again.');
    }
    // Re-validate redirect_uri against the registered client (anti open-redirect).
    const client = await provider.clientsStore.getClient(client_id);
    if (!client) return fail('Unknown client. Reconnect from the start.', 400);
    const allowed = Array.isArray(client.redirect_uris) && client.redirect_uris.includes(redirect_uri);
    if (!allowed) return fail('redirect_uri not registered for this client.', 400);
    if (!code_challenge) return fail('Missing PKCE challenge.', 400);

    const code = sign({ client_id, code_challenge, scope }, CODE_TTL, 'code');
    const u = new URL(redirect_uri);
    u.searchParams.set('code', code);
    if (state) u.searchParams.set('state', state);
    res.redirect(u.toString());
  };
}
