const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const { protect, adminOnly } = require('../middleware/auth');
const User     = require('../models/User');
const Playlist = require('../models/Playlist');
const Favorite = require('../models/Favorite');
const History  = require('../models/History');

// All admin routes require auth + admin role
router.use(protect, adminOnly);

// ═══════════════════════════════════════════════════════
//  DASHBOARD STATS
// ═══════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [users, playlists, favorites, history] = await Promise.all([
      User.countDocuments(),
      Playlist.countDocuments(),
      Favorite.countDocuments(),
      History.countDocuments(),
    ]);
    const totalChannels = (await Playlist.aggregate([
      { $group: { _id: null, total: { $sum: '$channelCount' } } }
    ]))[0]?.total || 0;

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('username email role createdAt avatar');

    const recentHistory = await History.find()
      .sort({ watchedAt: -1 })
      .limit(10)
      .populate('userId', 'username avatar');

    res.json({ users, playlists, totalChannels, favorites, history, recentUsers, recentHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  PLAYLIST MANAGEMENT
// ═══════════════════════════════════════════════════════

// GET /admin/playlists
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find()
      .sort({ createdAt: -1 })
      .populate('addedBy', 'username');
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/playlists — Add by URL or content
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

    // Parse to count channels & categories
    const { channelCount, categories } = parseM3UMeta(m3uText);
    if (channelCount === 0) return res.status(400).json({ error: 'No channels found in playlist' });

    const playlist = await Playlist.create({
      name,
      url:          url || null,
      channelCount,
      categories,
      isActive:     false,
      addedBy:      req.user._id,
    });

    // Also inject into in-memory store (so IPTV keeps working)
    req.app.locals.injectPlaylist?.({ name, url, content: m3uText, mongoId: playlist._id.toString() });

    res.status(201).json({ playlist, channelCount, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/playlists/:id
router.delete('/playlists/:id', async (req, res) => {
  try {
    const pl = await Playlist.findByIdAndDelete(req.params.id);
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    req.app.locals.removePlaylist?.(pl._id.toString());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/playlists/:id/activate
router.put('/playlists/:id/activate', async (req, res) => {
  try {
    await Playlist.updateMany({}, { isActive: false });
    const pl = await Playlist.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
    if (!pl) return res.status(404).json({ error: 'Playlist not found' });
    res.json({ ok: true, playlist: pl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  USER MANAGEMENT
// ═══════════════════════════════════════════════════════

// GET /admin/users
router.get('/users', async (req, res) => {
  try {
    const { q, role, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (q)    filter.$or = [
      { username: { $regex: q, $options: 'i' } },
      { email:    { $regex: q, $options: 'i' } },
    ];

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-password');

    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ error: 'Cannot delete yourself' });

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Clean up their data
    await Promise.all([
      Favorite.deleteMany({ userId: req.params.id }),
      History.deleteMany({ userId: req.params.id }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role))
      return res.status(400).json({ error: 'Role must be admin or user' });

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  FAVORITES & HISTORY (global view)
// ═══════════════════════════════════════════════════════

// GET /admin/favorites
router.get('/favorites', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = await Favorite.countDocuments();
    const favorites = await Favorite.find()
      .sort({ addedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('userId', 'username avatar');
    res.json({ favorites, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/history
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = await History.countDocuments();
    const history = await History.find()
      .sort({ watchedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('userId', 'username avatar');
    res.json({ history, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
//  CHANNEL OVERVIEW (reads from in-memory store)
// ═══════════════════════════════════════════════════════
router.get('/channels', (req, res) => {
  const getChannels = req.app.locals.getActiveChannels;
  if (!getChannels) return res.json({ channels: [], total: 0 });
  const { q, category, page = 1, limit = 100 } = req.query;
  let list = getChannels();
  if (category && category !== 'all') list = list.filter(c => c.group === category);
  if (q) { const ql = q.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(ql)); }
  const total = list.length;
  res.json({ channels: list.slice((page-1)*limit, page*limit), total });
});

// ─── helpers ──────────────────────────────────────────
function parseM3UMeta(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const catMap = {};
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF')) {
      const group = (line.match(/group-title="([^"]*)"/) || [])[1]?.trim() || 'Uncategorised';
      catMap[group] = (catMap[group] || 0) + 1;
      count++;
    }
  }

  const categories = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, c]) => ({ name, count: c }));

  return { channelCount: count, categories };
}

module.exports = router;
