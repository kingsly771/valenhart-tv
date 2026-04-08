/**
 * VALENHART TV — Admin Routes (SQLite-backed via db.js)
 */
const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');
const { protect, adminOnly } = require('../middleware/auth');

const getStore = (req) => req.app.locals.authStore;

// All admin routes require valid JWT + admin role
router.use((req, res, next) => protect(getStore(req))(req, res, next));
router.use(adminOnly);

// ── DASHBOARD STATS ───────────────────────────────────
router.get('/stats', (req, res) => {
  const s = getStore(req);
  const totalChannels = (req.app.locals.getActiveChannels?.() || []).length;

  const recentUsers = s.recentUsers(5).map(({ password: _, ...u }) => u);

  const recentHistory = s.recentHistory(10).map(h => ({
    ...h,
    userInfo: (() => {
      const u = s.findUserById(h.userId);
      return u ? { username: u.username, avatar: u.avatar } : null;
    })(),
  }));

  res.json({
    users:         s.countUsers(),
    playlists:     s.countPlaylists(),
    totalChannels,
    favorites:     s.countFavorites(),
    history:       s.countHistory(),
    recentUsers,
    recentHistory,
  });
});

// ── PLAYLISTS ─────────────────────────────────────────
router.get('/playlists', (req, res) => {
  const s = getStore(req);
  const playlists = s.getPlaylists().map(p => ({
    ...p,
    addedBy: s.findUserById(p.addedById)?.username || 'Admin',
  }));
  res.json({ playlists });
});

router.post('/playlists', async (req, res) => {
  try {
    const { name, url, content } = req.body;
    if (!name) return res.status(400).json({ error: 'Playlist name required' });
    if (!url && !content) return res.status(400).json({ error: 'URL or M3U content required' });

    let m3uText = content;
    if (url && !content) {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' },
        timeout: 20000,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      m3uText = await response.text();
    }

    const { channelCount, categories } = parseM3UMeta(m3uText);
    if (channelCount === 0) return res.status(400).json({ error: 'No channels found in playlist' });

    const s  = getStore(req);
    const pl = {
      _id:          String(Date.now()),
      name,
      url:          url || null,
      channelCount,
      categories,
      isActive:     false,
      addedById:    req.user.id,
      createdAt:    new Date().toISOString(),
    };
    s.insertPlaylist(pl);
    req.app.locals.injectPlaylist?.({ name, url, content: m3uText, playlistId: pl._id });
    res.status(201).json({ playlist: pl, channelCount, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/playlists/:id', (req, res) => {
  const s = getStore(req);
  const playlists = s.getPlaylists();
  if (!playlists.find(p => p._id === req.params.id))
    return res.status(404).json({ error: 'Playlist not found' });
  s.deletePlaylist(req.params.id);
  req.app.locals.removePlaylist?.(req.params.id);
  res.json({ ok: true });
});

router.put('/playlists/:id/activate', (req, res) => {
  const s = getStore(req);
  const playlists = s.getPlaylists();
  const pl = playlists.find(p => p._id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  // Mark all inactive then activate target
  playlists.forEach(p => s.insertPlaylist({ ...p, isActive: false }));
  s.insertPlaylist({ ...pl, isActive: true });
  res.json({ ok: true, playlist: { ...pl, isActive: true } });
});

// ── USERS ─────────────────────────────────────────────
router.get('/users', (req, res) => {
  const s = getStore(req);
  const { q, role, page = 1, limit = 20 } = req.query;

  let list = s.getUsers().map(({ password: _, ...u }) => u);
  if (role) list = list.filter(u => u.role === role);
  if (q) {
    const ql = q.toLowerCase();
    list = list.filter(u =>
      u.username.toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql)
    );
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = list.length;
  const pages = Math.ceil(total / limit);
  const slice = list.slice((page - 1) * limit, page * limit);
  res.json({ users: slice, total, page: Number(page), pages });
});

router.delete('/users/:id', (req, res) => {
  const s = getStore(req);
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Cannot delete yourself' });
  const user = s.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Remove user's favorites and history
  s.getFavoritesByUser(req.params.id).forEach(f =>
    s.deleteFavorite(req.params.id, f.channelId)
  );
  // Note: history has no bulk-delete by user in minimal API — handled in db.js for SQLite
  if (s._db_deleteUserHistory) s._db_deleteUserHistory(req.params.id);

  // For in-memory fallback: filter out
  if (!s._mem) {} // SQLite handles it
  else {
    s._mem.favorites = s._mem.favorites.filter(f => f.userId !== req.params.id);
    s._mem.history   = s._mem.history.filter(h => h.userId !== req.params.id);
  }

  // Remove user from DB
  if (s._db_deleteUser) s._db_deleteUser(req.params.id);
  else s._mem.users = s._mem.users.filter(u => u.id !== req.params.id);

  res.json({ ok: true });
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role))
    return res.status(400).json({ error: 'Role must be admin or user' });

  const s    = getStore(req);
  const user = s.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (s._db_updateUserRole) {
    s._db_updateUserRole(req.params.id, role);
  } else {
    const u = s._mem.users.find(u => u.id === req.params.id);
    if (u) u.role = role;
  }
  const { password: _, ...safe } = { ...user, role };
  res.json({ ok: true, user: safe });
});

// ── FAVORITES & HISTORY ───────────────────────────────
router.get('/favorites', (req, res) => {
  const s = getStore(req);
  const { page = 1, limit = 50 } = req.query;
  const sorted = s.getFavorites().sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  const total  = sorted.length;
  const slice  = sorted.slice((page - 1) * limit, page * limit).map(f => ({
    ...f,
    userInfo: (() => { const u = s.findUserById(f.userId); return u ? { username: u.username, avatar: u.avatar } : null; })(),
  }));
  res.json({ favorites: slice, total });
});

router.get('/history', (req, res) => {
  const s = getStore(req);
  const { page = 1, limit = 50 } = req.query;
  const sorted = s.getHistory().sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
  const total  = sorted.length;
  const slice  = sorted.slice((page - 1) * limit, page * limit).map(h => ({
    ...h,
    userInfo: (() => { const u = s.findUserById(h.userId); return u ? { username: u.username, avatar: u.avatar } : null; })(),
  }));
  res.json({ history: slice, total });
});

// ── CHANNELS ──────────────────────────────────────────
router.get('/channels', (req, res) => {
  const getChannels = req.app.locals.getActiveChannels;
  if (!getChannels) return res.json({ channels: [], total: 0 });
  const { q, category, page = 1, limit = 100 } = req.query;
  let list = getChannels();
  if (category && category !== 'all') list = list.filter(c => c.group === category);
  if (q) { const ql = q.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(ql)); }
  const total = list.length;
  res.json({ channels: list.slice((page - 1) * limit, page * limit), total });
});

// ── HELPER ────────────────────────────────────────────
function parseM3UMeta(text) {
  const lines  = text.replace(/\r/g, '').split('\n');
  const catMap = {};
  let count    = 0;
  for (const line of lines) {
    if (line.trim().startsWith('#EXTINF')) {
      const group = (line.match(/group-title="([^"]*)"/) || [])[1]?.trim() || 'Uncategorised';
      catMap[group] = (catMap[group] || 0) + 1;
      count++;
    }
  }
  const categories = Object.entries(catMap).sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, count: c }));
  return { channelCount: count, categories };
}

module.exports = router;
