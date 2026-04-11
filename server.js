/**
 * VALENHART TV v10.0 — Server
 * By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗
 *
 * Auth:  PostgreSQL + Prisma, JWT access + refresh tokens, httpOnly cookies
 * IPTV:  M3U playlist parsing, HLS proxy, REST API
 * Live:  Viewer counts via SSE  (/api/events)
 * Chat:  REST polling  (GET /api/chat/:channelId, POST /api/chat/:channelId)
 */

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fetch        = require('node-fetch');

const authRoutes   = require('./routes/auth');
const adminRoutes  = require('./routes/admin');
const userRoutes   = require('./routes/user');
const xtreamRoutes = require('./routes/xtream');
const { router: streamRouter, detectProtocol } = require('./services/stream.service');
const prisma       = require('./db');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// ═══════════════════════════════════════════════════════
//  SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy:    false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin:      process.env.NODE_ENV === 'production' ? process.env.APP_URL : true,
  credentials: true,
}));

app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/api/', apiLimiter);

// ═══════════════════════════════════════════════════════
//  IPTV IN-MEMORY STORE
// ═══════════════════════════════════════════════════════
const store = {
  playlists:        [],
  activePlaylistId: null,
  // viewers: channelId → Set of session IDs (heartbeat-based)
  viewers:          {},
  // sessions: sessionId → { channelId, lastSeen }
  sessions:         new Map(),
  // chat: channelId → [{id,user,avatar,message,ts}]
  chatRooms:        {},
  ratings:          {},
  demoChannels:     require('./data/channels.json'),
};

store.demoChannels.forEach(c => {
  store.ratings[String(c.id)] = {
    up:   Math.floor(Math.random() * 500) + 50,
    down: Math.floor(Math.random() * 30),
  };
});

// SSE clients: channelId → Set of res objects
const sseClients = new Map();

function ssePublish(channelId, event, data) {
  const clients = sseClients.get(channelId) || new Set();
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch {}
  });
}

function ssePublishAll(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(clients => {
    clients.forEach(res => { try { res.write(payload); } catch {} });
  });
}

// Prune stale sessions every 30s (session expired if no heartbeat for 45s)
setInterval(() => {
  const cutoff = Date.now() - 45000;
  store.sessions.forEach((sess, id) => {
    if (sess.lastSeen < cutoff) {
      const ch = sess.channelId;
      store.sessions.delete(id);
      if (ch && store.viewers[ch]) {
        store.viewers[ch].delete(id);
        ssePublish(ch, 'viewer_count', { channelId: ch, count: liveCount(ch) });
      }
    }
  });
}, 30000);

// Push updated viewer counts to all SSE clients every 5s
setInterval(() => {
  const channels = getActiveChannels();
  const counts = {};
  channels.forEach(c => { counts[c.id] = liveCount(c.id); });
  ssePublishAll('viewer_counts', counts);
}, 5000);

// Push EPG updates every 60s
setInterval(() => {
  ssePublishAll('epg_update', buildCurrentEPG());
}, 60000);

// ═══════════════════════════════════════════════════════
//  M3U PARSER
// ═══════════════════════════════════════════════════════
function parseM3U(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const channels = [];
  let current = null, idCounter = Date.now();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const name     = (line.match(/,(.+)$/)                || [])[1]?.trim() || 'Unknown';
      const group    = (line.match(/group-title="([^"]*)"/) || [])[1]?.trim() || 'Uncategorised';
      const logo     = (line.match(/tvg-logo="([^"]*)"/   ) || [])[1]?.trim() || '';
      const tvgId    = (line.match(/tvg-id="([^"]*)"/     ) || [])[1]?.trim() || '';
      const tvgName  = (line.match(/tvg-name="([^"]*)"/   ) || [])[1]?.trim() || name;
      const country  = (line.match(/tvg-country="([^"]*)"/  ) || [])[1]?.trim() || '';
      const language = (line.match(/tvg-language="([^"]*)"/  ) || [])[1]?.trim() || '';
      current = { id: String(++idCounter), name, group, logo, tvgId, tvgName, country, language, url: '' };
    } else if (line.startsWith('#')) {
      // skip
    } else if (current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

// ═══════════════════════════════════════════════════════
//  ACTIVE CHANNELS
// ═══════════════════════════════════════════════════════
function getActiveChannels() {
  const pl = store.playlists.find(p => p.id === store.activePlaylistId);
  if (pl && pl.channels.length) return pl.channels;
  return store.demoChannels.map(c => ({
    id: String(c.id), name: c.name, group: c.genre, logo: '', url: '',
    prog: c.prog, time: c.time, quality: c.quality, country: c.country || '',
    emoji: c.emoji || '📺', baseViewers: c.baseViewers || 1000,
  }));
}

function getCategories() {
  const map = {};
  getActiveChannels().forEach(ch => {
    const g = ch.group || 'Uncategorised';
    map[g] = (map[g] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function liveCount(channelId) {
  const real = store.viewers[channelId] ? store.viewers[channelId].size : 0;
  const ch   = getActiveChannels().find(c => c.id === channelId);
  const base = ch?.baseViewers || 1000;
  return real + Math.max(0, base + Math.floor(Math.sin(Date.now() / 30000) * base * 0.15));
}

app.locals.getActiveChannels = getActiveChannels;

app.locals.injectPlaylist = ({ name, url, content, playlistId }) => {
  const channels = parseM3U(content);
  if (!channels.length) return;
  const id = playlistId || String(Date.now());
  store.playlists.push({ id, name, url, channels, loadedAt: new Date().toISOString() });
  store.activePlaylistId = id;
};

app.locals.removePlaylist = (id) => {
  store.playlists = store.playlists.filter(p => p.id !== id);
  if (store.activePlaylistId === id)
    store.activePlaylistId = store.playlists[0]?.id || null;
};

// ═══════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════
app.use('/auth',        authRoutes);
app.use('/admin',       adminRoutes);
app.use('/api/user',    userRoutes);
app.use('/api/xtream',  xtreamRoutes);
app.use('/api/stream',  streamRouter);

// ═══════════════════════════════════════════════════════
//  SSE — /api/events
//  Client subscribes once; receives viewer_counts, epg_update
//  Client can also subscribe to a specific channel for viewer_count updates
// ═══════════════════════════════════════════════════════
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Add to global SSE bucket (channelId = '__all__')
  if (!sseClients.has('__all__')) sseClients.set('__all__', new Set());
  sseClients.get('__all__').add(res);

  // Send initial EPG + viewer counts immediately
  const channels = getActiveChannels();
  const counts = {};
  channels.forEach(c => { counts[c.id] = liveCount(c.id); });
  res.write(`event: viewer_counts\ndata: ${JSON.stringify(counts)}\n\n`);
  res.write(`event: epg_update\ndata: ${JSON.stringify(buildCurrentEPG())}\n\n`);

  // Keepalive ping every 20s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.get('__all__')?.delete(res);
  });
});

// SSE for a specific channel (viewer count + new chat messages)
app.get('/api/events/channel/:channelId', (req, res) => {
  const { channelId } = req.params;
  const sessionId = req.query.sid || String(Date.now() + Math.random());

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Track viewer
  if (!store.viewers[channelId]) store.viewers[channelId] = new Set();
  store.viewers[channelId].add(sessionId);
  store.sessions.set(sessionId, { channelId, lastSeen: Date.now() });

  // Register SSE client for this channel
  if (!sseClients.has(channelId)) sseClients.set(channelId, new Set());
  sseClients.get(channelId).add(res);

  // Send initial viewer count + chat history
  res.write(`event: viewer_count\ndata: ${JSON.stringify({ channelId, count: liveCount(channelId) })}\n\n`);
  const history = (store.chatRooms[channelId] || []).slice(-50);
  res.write(`event: chat_history\ndata: ${JSON.stringify({ messages: history })}\n\n`);

  // Announce updated count to everyone watching this channel
  ssePublish(channelId, 'viewer_count', { channelId, count: liveCount(channelId) });

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.get(channelId)?.delete(res);
    store.viewers[channelId]?.delete(sessionId);
    store.sessions.delete(sessionId);
    ssePublish(channelId, 'viewer_count', { channelId, count: liveCount(channelId) });
  });
});

// Heartbeat — client POSTs every 30s to keep session alive
app.post('/api/events/heartbeat', (req, res) => {
  const { sid } = req.body;
  if (sid && store.sessions.has(sid)) {
    store.sessions.get(sid).lastSeen = Date.now();
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
//  CHAT — REST polling
// ═══════════════════════════════════════════════════════
const AVATARS = ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆','🎪'];

// GET /api/chat/:channelId?since=<timestamp>
app.get('/api/chat/:channelId', (req, res) => {
  const { channelId } = req.params;
  const since = parseFloat(req.query.since || 0);
  const msgs  = (store.chatRooms[channelId] || []).filter(m => m.id > since);
  res.json({ messages: msgs });
});

// POST /api/chat/:channelId  { message, username?, avatar? }
app.post('/api/chat/:channelId', (req, res) => {
  const { channelId } = req.params;
  const { message, username, avatar } = req.body;
  if (!message?.trim() || message.length > 200)
    return res.status(400).json({ error: 'Invalid message' });

  const msg = {
    id:      Date.now() + Math.random(),
    user:    (username || 'Viewer').substring(0, 30),
    avatar:  avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
    message: message.trim().substring(0, 200),
    ts:      new Date().toISOString(),
  };

  if (!store.chatRooms[channelId]) store.chatRooms[channelId] = [];
  store.chatRooms[channelId].push(msg);
  if (store.chatRooms[channelId].length > 200) store.chatRooms[channelId].shift();

  // Push to SSE channel subscribers immediately
  ssePublish(channelId, 'new_message', { msg });

  res.status(201).json({ ok: true, msg });
});

// ═══════════════════════════════════════════════════════
//  PLAYLISTS
// ═══════════════════════════════════════════════════════
app.post('/api/playlist/url', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' }, timeout: 15000,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const channels = parseM3U(await response.text());
    if (!channels.length) return res.status(400).json({ error: 'No channels found in playlist' });
    const id = String(Date.now());
    const playlist = { id, name: name || extractDomainName(url), url, channels, loadedAt: new Date().toISOString() };
    store.playlists.push(playlist);
    store.activePlaylistId = id;
    res.json({ id, name: playlist.name, count: channels.length, categories: getCategories() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch playlist' });
  }
});

app.post('/api/playlist/upload', (req, res) => {
  const { content, name } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const channels = parseM3U(content);
  if (!channels.length) return res.status(400).json({ error: 'No channels found' });
  const id = String(Date.now());
  store.playlists.push({ id, name: name || 'Uploaded Playlist', channels, loadedAt: new Date().toISOString() });
  store.activePlaylistId = id;
  res.json({ id, name: name || 'Uploaded Playlist', count: channels.length, categories: getCategories() });
});

app.get('/api/playlists', (req, res) => {
  res.json({
    playlists: store.playlists.map(p => ({
      id: p.id, name: p.name, count: p.channels.length,
      active: p.id === store.activePlaylistId, loadedAt: p.loadedAt,
    })),
    activeId: store.activePlaylistId,
  });
});

app.post('/api/playlists/:id/activate', (req, res) => {
  const pl = store.playlists.find(p => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  store.activePlaylistId = pl.id;
  res.json({ ok: true, activeId: pl.id, categories: getCategories() });
});

app.delete('/api/playlists/:id', (req, res) => {
  store.playlists = store.playlists.filter(p => p.id !== req.params.id);
  if (store.activePlaylistId === req.params.id)
    store.activePlaylistId = store.playlists[0]?.id || null;
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════════════════
app.get('/api/channels', (req, res) => {
  const { category, q, page = 1, limit = 200 } = req.query;
  let list = getActiveChannels();
  if (category && category !== 'all')
    list = list.filter(c => (c.group || '').toLowerCase() === category.toLowerCase());
  if (q) {
    const ql = q.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(ql) ||
      (c.group || '').toLowerCase().includes(ql) ||
      (c.prog  || '').toLowerCase().includes(ql)
    );
  }
  const total  = list.length;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const slice  = list.slice(offset, offset + parseInt(limit));
  const viewerCounts = {};
  slice.forEach(c => { viewerCounts[c.id] = liveCount(c.id); });
  res.json({ channels: slice, viewerCounts, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/categories', (req, res) => res.json({ categories: getCategories() }));

app.get('/api/channels/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const ql = q.toLowerCase();
  const found = getActiveChannels()
    .filter(c => c.name.toLowerCase().includes(ql) || (c.group || '').toLowerCase().includes(ql))
    .slice(0, 50);
  res.json({ results: found });
});

// ═══════════════════════════════════════════════════════
//  RATINGS
// ═══════════════════════════════════════════════════════
app.get('/api/ratings/:channelId', (req, res) => {
  res.json(store.ratings[req.params.channelId] || { up: 0, down: 0 });
});

app.post('/api/ratings/:channelId', (req, res) => {
  const key = req.params.channelId;
  const { vote } = req.body;
  if (!store.ratings[key]) store.ratings[key] = { up: 0, down: 0 };
  if (vote === 'up' || vote === 'down') store.ratings[key][vote]++;
  // Push rating update to channel SSE subscribers
  ssePublish(key, 'rating_update', { channelId: key, ...store.ratings[key] });
  res.json(store.ratings[key]);
});

// ═══════════════════════════════════════════════════════
//  EPG & STATS
// ═══════════════════════════════════════════════════════
app.get('/api/epg', (req, res) => res.json(buildCurrentEPG()));

app.get('/api/stats', (req, res) => {
  const totalReal = Object.values(store.viewers).reduce((s, set) => s + set.size, 0);
  res.json({
    totalViewers:   totalReal + 42800,
    onlineUsers:    store.sessions.size,
    activeChannels: getActiveChannels().length,
    playlists:      store.playlists.length,
    categories:     getCategories().length,
  });
});

// ═══════════════════════════════════════════════════════
//  CORS PROXY — legacy compat redirects to /api/stream/proxy
// ═══════════════════════════════════════════════════════
app.get('/api/proxy/stream', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url required');
  // Redirect to new universal stream proxy
  res.redirect(302, `/api/stream/proxy?url=${encodeURIComponent(decodeURIComponent(url))}`);
});

app.get('/api/proxy/m3u', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');
  try {
    const resp = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' }, timeout: 20000,
    });
    const text = await resp.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════════════
app.get('/admin-panel*', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const SECRET = process.env.JWT_ACCESS_SECRET;
    const token = req.query.token
      || (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.split(' ')[1] : null);
    if (token && SECRET) {
      try {
        const decoded = jwt.verify(token, SECRET);
        const user = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { role: true } });
        if (user && user.role !== 'admin') return res.redirect('/?notice=admin_only');
      } catch {}
    }
  } catch {}
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function getBaseUrl(url) {
  const u = new URL(url);
  return u.origin + u.pathname.replace(/\/[^/]*$/, '');
}

function extractDomainName(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return 'Playlist'; }
}

function buildCurrentEPG() {
  try {
    const EPG = require('./data/epg.json');
    const now = new Date();
    return EPG.map(row => ({
      ...row,
      programs: row.programs.map(p => {
        const [h, m] = p.start.split(':').map(Number);
        const start = new Date(); start.setHours(h, m, 0, 0);
        const end   = new Date(start.getTime() + p.duration * 60000);
        return { ...p, isNow: now >= start && now < end, startMs: start.getTime(), endMs: end.getTime() };
      }),
    }));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await prisma.$connect();
    console.log('  💾 PostgreSQL connected via Prisma');
  } catch (err) {
    console.error('  ❌ Database connection failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n  ⬡  VALENHART TV v11.0`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log(`  🔐 Auth:    POST /auth/register  /auth/login`);
    console.log(`  🔄 Token:   POST /auth/refresh   /auth/logout`);
    console.log(`  📡 Xtream:  POST /api/xtream/connect`);
    console.log(`  📺 Events:  GET  /api/events  (SSE)`);
    console.log(`  💬 Chat:    GET/POST /api/chat/:channelId`);
    console.log(`  🔀 Stream:  GET  /api/stream/proxy  (universal)`);
    console.log(`  🎬 HLS:     GET  /api/stream/hls    (transcode)`);
    console.log(`  🔍 Probe:   GET  /api/stream/probe`);
    console.log(`  🛡️  Admin:   /admin-panel`);
    console.log(`  💾 DB:      PostgreSQL (Prisma)`);
    console.log(`  ─────────────────────────────────────────\n`);
  });
}

start();
