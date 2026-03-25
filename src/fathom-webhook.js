/**
 * Fathom Webhook Handler
 * Receives "meeting_content_ready" webhooks from Fathom
 * and pushes the meeting data to the DeFlorance Notion database.
 * 
 * Env vars required:
 *   NOTION_TOKEN_FATHOM  — Notion integration token (DeFlorance "Fathom Importer")
 *   NOTION_DB_ID_FATHOM  — Notion database ID (Fathom Recordings)
 *   FATHOM_WEBHOOK_SECRET — Webhook secret from Fathom (whsec_...)
 */

import crypto from 'crypto';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function env(key) { return process.env[key] || ''; }

async function notionRequest(method, endpoint, body) {
  const url = `${NOTION_API}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${env('NOTION_TOKEN_FATHOM')}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, opts);
      const data = await res.json();
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, Math.max(parseFloat(data.retry_after || '2'), 2) * 1000));
        continue;
      }
      return data;
    } catch (e) {
      console.error(`[Fathom→Notion] Request error (${attempt + 1}/3):`, e.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

function chunks(text, size = 2000) {
  if (!text) return [];
  const out = [];
  for (let i = 0; i < text.length; i += size)
    out.push({ type: 'text', text: { content: text.slice(i, i + size) } });
  return out;
}

function fmtTranscript(t) {
  if (!t?.length) return '';
  return t.map(x => `[${x.timestamp || ''}] ${x.speaker?.display_name || '?'}: ${x.text || ''}`).join('\n');
}

function fmtActions(items) {
  if (!items?.length) return '';
  return items.map(x => {
    const s = x.completed ? '✅' : '⬜';
    const a = x.assignee?.name;
    return `${s} ${x.description || ''}${a ? ` (→ ${a})` : ''}`;
  }).join('\n');
}

function calcDuration(m) {
  try {
    if (m.recording_start_time && m.recording_end_time)
      return Math.round((new Date(m.recording_end_time) - new Date(m.recording_start_time)) / 60000 * 10) / 10;
  } catch {}
  return null;
}

function buildBlocks(m) {
  const blocks = [];
  const addSection = (heading, text) => {
    if (!text) return;
    blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: heading } }] } });
    for (const c of chunks(text))
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [c] } });
  };
  addSection('Summary', m.default_summary?.markdown_formatted);
  addSection('Action Items', fmtActions(m.action_items));
  addSection('Transcript', fmtTranscript(m.transcript));
  return blocks.slice(0, 100);
}

async function pushToNotion(meeting) {
  const dbId = env('NOTION_DB_ID_FATHOM');
  const title = meeting.title || meeting.meeting_title || 'Untitled Meeting';
  const rb = meeting.recorded_by;
  const rec = rb ? `${rb.name || ''} <${rb.email || ''}>` : '';
  const invs = (meeting.calendar_invitees || []).slice(0, 20);
  const parts = invs.map(i => `${i.name || ''} <${i.email || ''}>`.trim()).join(', ');
  const mType = meeting.calendar_invitees_domains_type === 'one_or_more_external' ? 'External' : 'Internal';
  const dur = calcDuration(meeting);

  const props = {
    'Name': { title: [{ text: { content: title.slice(0, 2000) } }] },
    'Recorded By': { rich_text: [{ text: { content: rec.slice(0, 2000) } }] },
    'Participants': { rich_text: chunks(parts.slice(0, 2000)).length ? chunks(parts.slice(0, 2000)) : [{ text: { content: '' } }] },
    'Type': { select: { name: mType } },
    'Has Transcript': { checkbox: !!meeting.transcript },
    'Has Summary': { checkbox: !!meeting.default_summary },
    'Has Action Items': { checkbox: !!(meeting.action_items?.length) },
    'Recording ID': { number: meeting.recording_id || 0 },
  };
  if (meeting.created_at) props['Date'] = { date: { start: meeting.created_at.slice(0, 10) } };
  if (dur !== null) props['Duration (min)'] = { number: dur };
  if (meeting.url) props['Fathom URL'] = { url: meeting.url };
  if (meeting.share_url) props['Share URL'] = { url: meeting.share_url };

  const blocks = buildBlocks(meeting);
  const body = { parent: { database_id: dbId }, properties: props };
  if (blocks.length) body.children = blocks;

  let result = await notionRequest('POST', '/pages', body);
  if (result?.id) {
    console.log(`[Fathom→Notion] ✓ ${title}`);
    return true;
  }

  // Fallback: push without blocks, then append separately
  const err = result?.message || '';
  if (blocks.length && (err.includes('body.children') || err.toLowerCase().includes('validation'))) {
    delete body.children;
    result = await notionRequest('POST', '/pages', body);
    if (result?.id) {
      for (let i = 0; i < blocks.length; i += 100)
        await notionRequest('PATCH', `/blocks/${result.id}/children`, { children: blocks.slice(i, i + 100) });
      console.log(`[Fathom→Notion] ✓ (split) ${title}`);
      return true;
    }
  }

  console.error(`[Fathom→Notion] ✗ ${title} — ${err}`);
  return false;
}

function verifySignature(secret, headers, rawBody) {
  if (!secret) return true;
  try {
    const id = headers['webhook-id'];
    const ts = headers['webhook-timestamp'];
    const sig = headers['webhook-signature'];
    if (!id || !ts || !sig) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10)) > 300) return false;
    const key = Buffer.from(secret.split('_')[1], 'base64');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
    return sig.split(' ').some(s => {
      const v = s.includes(',') ? s.split(',')[1] : s;
      try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v)); } catch { return false; }
    });
  } catch (e) {
    console.error('[Fathom Webhook] Verify error:', e.message);
    return false;
  }
}

export function fathomWebhookHandler(app) {
  app.post('/fathom-webhook', async (req, res) => {
    try {
      const secret = env('FATHOM_WEBHOOK_SECRET');
      if (secret && !verifySignature(secret, req.headers, req.rawBody || '')) {
        console.warn('[Fathom Webhook] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Fathom may send flat meeting data or wrap in {event, data}
      const raw = req.body;
      const meeting = raw.data && typeof raw.data === 'object' && (raw.data.title || raw.data.recording_id)
        ? raw.data
        : raw;
      console.log(`[Fathom Webhook] Received: ${meeting.title || meeting.meeting_title || '?'} (id: ${meeting.recording_id || meeting.call_id || '?'})`);

      // Respond 200 immediately so Fathom doesn't retry
      res.status(200).json({ status: 'received' });

      // Push to Notion async
      await pushToNotion(meeting);
    } catch (e) {
      console.error('[Fathom Webhook] Error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
  });

  console.log('[Fathom Webhook] Registered POST /fathom-webhook');
}
