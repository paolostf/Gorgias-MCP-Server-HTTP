#!/usr/bin/env node
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createServer } from './server.js';
import { GorgiasOAuthProvider, makeConsentHandler, oauthEnabled } from './oauth-provider.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const PUBLIC_URL = (process.env.PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)
).replace(/\/$/, '');

const app = express();

// Store raw body for webhook signature verification (preserved from original)
app.use(express.json({
  limit: '25mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: false }));

// CORS — MCP auth is via the Authorization header (no cookies), so credentials:false.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const sessions = new Map();
const serverStartTime = new Date();

// ─── OAuth 2.1 (claude.ai connector compatibility) ───
const oauthProvider = new GorgiasOAuthProvider();
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(`${PUBLIC_URL}/mcp`));
let oauthBearer = null;
if (oauthEnabled()) {
  app.post('/oauth/consent', makeConsentHandler(oauthProvider));
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: new URL(PUBLIC_URL),
    baseUrl: new URL(PUBLIC_URL),
    resourceServerUrl: new URL(`${PUBLIC_URL}/mcp`),
    scopesSupported: ['mcp'],
    resourceName: 'Gorgias MCP',
  }));
  oauthBearer = requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl });
}

// Dual auth: static bearer (Claude Code / headless) short-circuits; otherwise OAuth (claude.ai).
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
function staticBearerMatches(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  if (!token || !MCP_AUTH_TOKEN) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(MCP_AUTH_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function combinedAuth(req, res, next) {
  if (!MCP_AUTH_TOKEN && !oauthEnabled()) return next(); // backward compatible: fully open if neither configured
  if (staticBearerMatches(req)) return next();           // Claude Code static bearer
  if (oauthBearer) return oauthBearer(req, res, next);    // claude.ai OAuth (401 + WWW-Authenticate)
  // static configured but no OAuth and token didn't match → reject
  res.set('WWW-Authenticate', 'Bearer');
  return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid bearer token' });
}

app.get('/health', (req, res) => {
  const modes = [MCP_AUTH_TOKEN && 'bearer', oauthEnabled() && 'oauth'].filter(Boolean).join('+') || 'open';
  res.json({
    status: 'ok',
    server: 'Gorgias MCP Server',
    version: pkg.version,
    node_version: process.version,
    auth: modes,
    sessions: sessions.size,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    started_at: serverStartTime.toISOString(),
    current_time: new Date().toISOString(),
  });
});

app.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive', uptime_ms: Date.now() - serverStartTime.getTime() });
});

app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready' });
});

// --- MCP Endpoints ---

app.post('/mcp', combinedAuth, async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await session.transport.handleRequest(req, res, req.body);
    } else {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      const server = createServer();
      await server.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, { transport, server });
      }
    }
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/mcp', combinedAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const session = sessions.get(sessionId);
  await session.transport.handleRequest(req, res);
});

app.delete('/mcp', combinedAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    await session.transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).json({ status: 'session closed' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const modes = [MCP_AUTH_TOKEN && 'bearer', oauthEnabled() && 'oauth'].filter(Boolean).join('+') || 'OPEN';
  console.log(`Gorgias MCP Server v${pkg.version} on port ${PORT} — auth: ${modes} — public: ${PUBLIC_URL}`);
});
