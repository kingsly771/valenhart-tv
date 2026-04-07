const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const { protect, adminOnly } = require('../middleware/auth');
const { getDB } = require('../config/db');

router.use(protect, adminOnly);

// GET /admin/stats
router.get('/stats', (req, res) => {
  try {
    const db = getDB();
    const users       = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const playlists   = db.prepare('SELECT COUNT(*) as c FROM playlists').get().c;
    const favorites   = db.prepare('SELECT COUNT(*) as c FROM favorites').get().c;
    const history     = db.prepare('SELECT COUNT(*) as c FROM history').get().c;
    const totalChannels = db.prepare('SELECT SUM(channel_count) as t FROM playlists').get().t || 0;
    const recentUsers = db.prepare('SELECT id,username,email,role,avatar,created_at FROM users ORDER BY created_at DESC LIMIT 5').all();
    const recentHistory = db.prepare(`
      SELECT h.*, u.username, u.avatar as user_avatar
      FROM history h LEFT JOIN users u ON h.user_id=u.id
      ORDER BY h.watched_at DESC LIMIT 10
    `).all();
    res.json({ users, playlists, totalChannels, favorites, history, recentUsers, recentHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/playlists
router.get('/playlists', (req, res) => {
  try {
    const rows = getDB().prepare(`
      SELECT p.*, u.username as added_by_name
      FROM playlists p LEFT JOIN users u ON p.added_by=u.id
      ORDER BY p.created_at DESC
    `).all();
    res.json({ playlists: rows.map(r => ({ ...r, categories: JSON.parse(r.categories || '[]') })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/playlists
router.post('/playlists', async (req, res) => {
  try {
    const { name, url, content } = req.body;
    if (!name) return res.status(400).json({ error: 'Playlist name required' });
    if (!url && !content) return res.status(400).json({ error: 'URL or M3U content required' });

    let m3uText = content;
    if (url && !content) {
      const response = await fetch(url, { headers: { 'User-Agent': 'VLC/3.0.16' }, timeout: 20000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      m3uText = await response.text();
    }

    const { channelCount, categories } = parseM3UMeta(m3uText);
    if (channelCount === 0) return res.status(400).json({ error: 'No channels found' });

    const db = getDB();
    const result = db.prepare(
      'INSERT INTO playlists (name,url,channel_count,categories,added_by) VALUES (?,?,?,?,?)'
    ).run(name, url || null, channelCount, JSON.stringify(categories), req.user.id);

    const playlist = db.prepare('SELECT * FROM playlists WHERE id=?').get(result.lastInsertRowid);
    req.app.locals.injectPlaylist?.({ name, url, content: m3uText, mongoId: String(playlist.id) });

    res.status(201).json({ playlist, channelCount, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/playlists/:id
router.delete('/playlists/:id', (req, res) => {
  try {
    const db = getDB();
    const pl = db.prepare('SELECT * FROM playlists WHERE id=?').get(req.params.id);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    db.prepare('DELETE FROM playlists WHERE id=?').run(req.params.id);
    req.app.locals.removePlaylist?.(String(pl.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/playlists/:id/activate
router.put('/playlists/:id/activate', (req, res) => {
  try {
    const db = getDB();
    db.prepare('UPDATE playlists SET is_active=0').run();
    db.prepare('UPDATE playlists SET is_active=1 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/users
router.get('/users', (req, res) => {
  try {
    const { q, role, page = 1, limit = 20 } = req.query;
    const db = getDB();
    let sql = 'SELECT id,username,email,role,avatar,is_active,created_at FROM users WHERE 1=1';
    const params = [];
    if (role)  { sql += ' AND role=?';                              params.push(role); }
    if (q)     { sql += ' AND (username LIKE ? OR email LIKE ?)';  params.push(`%${q}%`, `%${q}%`); }
    const total = db.prepare(sql.replace('SELECT id,username,email,role,avatar,is_active,created_at', 'SELECT COUNT(*) as c')).get(...params).c;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const users = db.prepare(sql).all(...params);
    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/users/:id
router.delete('/users/:id', (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id))
      return res.status(400).json({ error: 'Cannot delete yourself' });
    const db = getDB();
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/users/:id/role
router.put('/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const db = getDB();
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
    const user = db.prepare('SELECT id,username,email,role,avatar FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/favorites
router.get('/favorites', (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const db = getDB();
    const total = db.prepare('SELECT COUNT(*) as c FROM favorites').get().c;
    const favorites = db.prepare(`
      SELECT f.*, u.username, u.avatar as user_avatar
      FROM favorites f LEFT JOIN users u ON f.user_id=u.id
      ORDER BY f.added_at DESC LIMIT ? OFFSET ?
    `).all(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ favorites, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/history
router.get('/history', (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const db = getDB();
    const total = db.prepare('SELECT COUNT(*) as c FROM history').get().c;
    const history = db.prepare(`
      SELECT h.*, u.username, u.avatar as user_avatar
      FROM history h LEFT JOIN users u ON h.user_id=u.id
      ORDER BY h.watched_at DESC LIMIT ? OFFSET ?
    `).all(Number(limit), (Number(page) - 1) * Number(limit));
    res.json({ history, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/channels
router.get('/channels', (req, res) => {
  const getChannels = req.app.locals.getActiveChannels;
  if (!getChannels) return res.json({ channels: [], total: 0 });
  const { q, category, page = 1, limit = 100 } = req.query;
  let list = getChannels();
  if (category && category !== 'all') list = list.filter(c => c.group === category);
  if (q) { const ql = q.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(ql)); }
  res.json({ channels: list.slice((page-1)*limit, page*limit), total: list.length });
});

function parseM3UMeta(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const catMap = {};
  let count = 0;
  for (const line of lines) {
    if (line.trim().startsWith('#EXTINF')) {
      const group = (line.match(/group-title="([^"]*)"/) || [])[1]?.trim() || 'Uncategorised';
      catMap[group] = (catMap[group] || 0) + 1;
      count++;
    }
  }
  return { channelCount: count, categories: Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([name,c])=>({name,count:c})) };
}

module.exports = router;
