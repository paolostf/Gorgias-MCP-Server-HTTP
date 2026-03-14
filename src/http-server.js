#!/usr/bin/env node
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { server } from './server.js';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
app.use(express.json());

const transports = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'Gorgias MCP Server' });
});

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      await server.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };
    }

    await transport.handleRequest(req, res, req.body);

    if (!sessionId && transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const transport = transports.get(sessionId);
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    await transport.close();
    transports.delete(sessionId);
  }
  res.status(200).json({ status: 'session closed' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Gorgias MCP Server (HTTP) running on port ' + PORT);
  console.log('MCP endpoint: http://0.0.0.0:' + PORT + '/mcp');
});
