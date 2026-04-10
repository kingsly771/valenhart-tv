/**
 * VALENHART TV v5.0 — Server
 * By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗
 *
 * Auth: PostgreSQL + Prisma, JWT access + refresh tokens, httpOnly cookies
 * IPTV: M3U playlist parsing, HLS proxy, Socket.IO viewer/chat/EPG
 */

require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fetch        = require('node-fetch');

const authRoutes  = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes  = require('./routes/user');
const prisma      = require('./db');
const { apiLimiter } = require('./middleware/rateLimiter');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ═══════════════════════════════════════════════════════
//  SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,   // disabled — frontend loads CDN scripts
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin:      process.env.NODE_ENV === 'production'
                 ? process.env.APP_URL
                 : true,
  credentials: true,             // required for httpOnly cookie cross-origin
}));

app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// General API rate limit
app.use('/api/', apiLimiter);

// ═══════════════════════════════════════════════════════
//  IPTV IN-MEMORY STORE (playlists, viewers, chat)
// ═══════════════════════════════════════════════════════
const store = {
  playlists:        [],
  activePlaylistId: null,
  viewers:          {},
  chatRooms:        {},
  watchlists:       {},
  onlineUsers:      new Map(),
  ratings:          {},
  demoChannels:     require('./data/channels.json'),
};

store.demoChannels.forEach(c => {
  store.ratings[String(c.id)] = {
    up:   Math.floor(Math.random() * 500) + 50,
    down: Math.floor(Math.random() * 30),
  };
});

// ═══════════════════════════════════════════════════════
//  M3U PARSER
// ═══════════════════════════════════════════════════════
function parseM3U(text) {
  const lines    = text.replace(/\r/g, '').split('\n');
  const channels = [];
  let current    = null;
  let idCounter  = Date.now();

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
      // skip other directives
    } else if (current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

// ═══════════════════════════════════════════════════════
//  ACTIVE CHANNELS HELPER
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
    map[g]  = (map[g] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
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
//  AUTH + API ROUTES
// ═══════════════════════════════════════════════════════
app.use('/auth',     authRoutes);
app.use('/admin',    adminRoutes);
app.use('/api/user', userRoutes);

// ═══════════════════════════════════════════════════════
//  PLAYLIST ENDPOINTS
// ═══════════════════════════════════════════════════════
app.post('/api/playlist/url', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' },
      timeout: 15000,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text     = await response.text();
    const channels = parseM3U(text);
    if (!channels.length) return res.status(400).json({ error: 'No channels found in playlist' });
    const id       = String(Date.now());
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
  slice.forEach(c => {
    const base = c.baseViewers || Math.floor(Math.random() * 5000) + 500;
    const real = store.viewers[c.id] ? store.viewers[c.id].size : 0;
    viewerCounts[c.id] = real + Math.max(0, base + Math.floor(Math.sin(Date.now() / 30000 + parseInt(c.id) || 0) * base * 0.15));
  });
  res.json({ channels: slice, viewerCounts, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/categories', (req, res) => res.json({ categories: getCategories() }));

app.get('/api/channels/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const ql    = q.toLowerCase();
  const found = getActiveChannels()
    .filter(c => c.name.toLowerCase().includes(ql) || (c.group || '').toLowerCase().includes(ql))
    .slice(0, 50);
  res.json({ results: found });
});

// ═══════════════════════════════════════════════════════
//  ANONYMOUS FAVORITES (session-based via socket id)
// ═══════════════════════════════════════════════════════
app.get('/api/favorites', (req, res) => {
  const sid = req.headers['x-socket-id'] || 'anon';
  const ids = Array.from(store.watchlists[sid] || []);
  res.json({ favorites: getActiveChannels().filter(c => ids.includes(c.id)) });
});

app.post('/api/favorites/:channelId', (req, res) => {
  const sid = req.headers['x-socket-id'] || 'anon';
  if (!store.watchlists[sid]) store.watchlists[sid] = new Set();
  store.watchlists[sid].add(req.params.channelId);
  res.json({ ok: true, count: store.watchlists[sid].size });
});

app.delete('/api/favorites/:channelId', (req, res) => {
  const sid = req.headers['x-socket-id'] || 'anon';
  if (store.watchlists[sid]) store.watchlists[sid].delete(req.params.channelId);
  res.json({ ok: true });
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
  io.to(`channel:${key}`).emit('rating_update', { channelId: key, ...store.ratings[key] });
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
    onlineUsers:    store.onlineUsers.size,
    activeChannels: getActiveChannels().length,
    playlists:      store.playlists.length,
    categories:     getCategories().length,
  });
});

// ═══════════════════════════════════════════════════════
//  CORS PROXY (stream + M3U)
// ═══════════════════════════════════════════════════════
app.get('/api/proxy/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');
  try {
    const upstream = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16', 'Accept': '*/*' },
    });
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (ct.includes('mpegurl') || url.includes('.m3u8')) {
      const text = await upstream.text();
      const base = getBaseUrl(decodeURIComponent(url));
      const rewritten = text.replace(/^(?!#)(.+)$/gm, line => {
        if (line.startsWith('http')) return `/api/proxy/stream?url=${encodeURIComponent(line)}`;
        if (line.startsWith('/'))    return `/api/proxy/stream?url=${encodeURIComponent(base + line)}`;
        return `/api/proxy/stream?url=${encodeURIComponent(base + '/' + line)}`;
      });
      return res.send(rewritten);
    }
    upstream.body.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

app.get('/api/proxy/m3u', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');
  try {
    const resp = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' },
      timeout: 20000,
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
//  SOCKET.IO
// ═══════════════════════════════════════════════════════
const AVATARS = ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆','🎪'];

io.on('connection', (socket) => {
  const username = `Viewer${Math.floor(Math.random() * 9000) + 1000}`;
  const avatar   = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  store.onlineUsers.set(socket.id, { name: username, avatar, currentChannel: null });
  socket.emit('welcome', { username, socketId: socket.id });
  io.emit('online_count', store.onlineUsers.size);

  socket.on('join_channel', (channelId) => {
    const user = store.onlineUsers.get(socket.id);
    if (user?.currentChannel) {
      const prev = user.currentChannel;
      socket.leave(`channel:${prev}`);
      if (store.viewers[prev]) store.viewers[prev].delete(socket.id);
      io.to(`channel:${prev}`).emit('viewer_join_leave', { channelId: prev, count: liveCount(prev) });
    }
    socket.join(`channel:${channelId}`);
    if (!store.viewers[channelId]) store.viewers[channelId] = new Set();
    store.viewers[channelId].add(socket.id);
    if (user) user.currentChannel = channelId;
    const history = (store.chatRooms[channelId] || []).slice(-50);
    socket.emit('chat_history', { channelId, messages: history });
    io.to(`channel:${channelId}`).emit('viewer_join_leave', { channelId, count: liveCount(channelId) });
  });

  socket.on('chat_message', ({ channelId, message }) => {
    if (!message?.trim() || message.length > 200) return;
    const user = store.onlineUsers.get(socket.id);
    const msg  = {
      id:      Date.now() + Math.random(),
      user:    user?.name   || 'Unknown',
      avatar:  user?.avatar || '🎭',
      message: message.trim().substring(0, 200),
      ts:      new Date().toISOString(),
    };
    if (!store.chatRooms[channelId]) store.chatRooms[channelId] = [];
    store.chatRooms[channelId].push(msg);
    if (store.chatRooms[channelId].length > 200) store.chatRooms[channelId].shift();
    io.to(`channel:${channelId}`).emit('new_message', { channelId, msg });
  });

  socket.on('toggle_watchlist', (channelId) => {
    if (!store.watchlists[socket.id]) store.watchlists[socket.id] = new Set();
    const wl    = store.watchlists[socket.id];
    const added = !wl.has(channelId);
    if (added) wl.add(channelId); else wl.delete(channelId);
    socket.emit('watchlist_update', { channelId, added });
    socket.emit('watchlist_state', Array.from(wl));
  });

  socket.on('get_watchlist', () =>
    socket.emit('watchlist_state', Array.from(store.watchlists[socket.id] || []))
  );

  socket.on('disconnect', () => {
    const user = store.onlineUsers.get(socket.id);
    if (user?.currentChannel) {
      const ch = user.currentChannel;
      if (store.viewers[ch]) store.viewers[ch].delete(socket.id);
      io.to(`channel:${ch}`).emit('viewer_join_leave', { channelId: ch, count: liveCount(ch) });
    }
    store.onlineUsers.delete(socket.id);
    io.emit('online_count', store.onlineUsers.size);
  });
});

setInterval(() => {
  const channels = getActiveChannels();
  const counts   = {};
  channels.forEach(c => {
    const base = c.baseViewers || 1000;
    const real = store.viewers[c.id] ? store.viewers[c.id].size : 0;
    counts[c.id] = real + Math.max(0, base + Math.floor(Math.sin(Date.now() / 30000 + (parseInt(c.id) || 0)) * base * 0.15));
  });
  io.emit('viewer_counts', counts);
}, 3000);

setInterval(() => io.emit('epg_update', buildCurrentEPG()), 30000);

// ── Admin panel page (server-side role check) ─────────────
app.get('/admin-panel*', async (req, res) => {
  try {
    const jwt         = require('jsonwebtoken');
    const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
    const token       = req.query.token
      || (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.split(' ')[1]
          : null);

    if (token && ACCESS_SECRET) {
      try {
        const decoded = jwt.verify(token, ACCESS_SECRET);
        const user    = await prisma.user.findUnique({
          where:  { id: decoded.sub },
          select: { role: true },
        });
        if (user && user.role !== 'admin')
          return res.redirect('/?notice=admin_only');
      } catch { /* invalid token — let client overlay handle auth */ }
    }
  } catch { /* non-critical */ }

  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function liveCount(channelId) {
  const real = store.viewers[channelId] ? store.viewers[channelId].size : 0;
  const ch   = getActiveChannels().find(c => c.id === channelId);
  const base = ch?.baseViewers || 1000;
  return real + Math.max(0, base + Math.floor(Math.sin(Date.now() / 30000) * base * 0.15));
}

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
        const start  = new Date(); start.setHours(h, m, 0, 0);
        const end    = new Date(start.getTime() + p.duration * 60000);
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
    console.error('     Make sure DATABASE_URL is set and the DB is running.');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`\n  ⬡  VALENHART TV v5.0`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log(`  🔐 Auth:  POST /auth/register  /auth/login`);
    console.log(`  🔄 Token: POST /auth/refresh   /auth/logout`);
    console.log(`  🛡️  Admin: /admin-panel`);
    console.log(`  📡 Socket.IO active`);
    console.log(`  🔀 M3U proxy: /api/proxy`);
    console.log(`  💾 Storage: PostgreSQL (Prisma)`);
    console.log(`  ─────────────────────────────────────────\n`);
  });
}

start();
