/**
 * VALENHART TV v5 — Admin Routes (PostgreSQL via Prisma)
 * All routes require: valid JWT access token + role === 'admin'
 */

const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { protect, adminOnly } = require('../middleware/auth');
const prisma = require('../db');

// ── Auth guards on every admin route ─────────────────────
router.use(protect);
router.use(adminOnly);

// ══════════════════════════════════════════════════════════
//  GET /admin/stats
// ══════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [
      userCount,
      playlistCount,
      favoriteCount,
      historyCount,
      recentUsers,
      recentHistory,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.playlist.count(),
      prisma.favorite.count(),
      prisma.watchHistory.count(),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, username: true, email: true, role: true, avatar: true, createdAt: true, lastSeen: true, isVerified: true },
      }),
      prisma.watchHistory.findMany({
        orderBy: { watchedAt: 'desc' },
        take: 10,
        include: {
          user: { select: { username: true, avatar: true } },
        },
      }),
    ]);

    const totalChannels = (req.app.locals.getActiveChannels?.() || []).length;

    res.json({
      users:         userCount,
      playlists:     playlistCount,
      totalChannels,
      favorites:     favoriteCount,
      history:       historyCount,
      recentUsers,
      recentHistory: recentHistory.map(h => ({
        ...h,
        group:    h.grp,
        userInfo: h.user ? { username: h.user.username, avatar: h.user.avatar } : null,
        user:     undefined,
      })),
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════
router.get('/users', async (req, res) => {
  try {
    const { q, role, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      ...(role  ? { role } : {}),
      ...(q     ? { OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email:    { contains: q, mode: 'insensitive' } },
      ]} : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take:    Number(limit),
        orderBy: { createdAt: 'desc' },
        select:  { id: true, username: true, email: true, role: true, avatar: true, isVerified: true, createdAt: true, lastSeen: true },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'Cannot delete yourself' });

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cascade deletes handle refresh tokens, favorites, history (see schema onDelete: Cascade)
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role))
      return res.status(400).json({ error: 'Role must be admin or user' });

    const user = await prisma.user.update({
      where:  { id: req.params.id },
      data:   { role },
      select: { id: true, username: true, email: true, role: true, avatar: true },
    });
    res.json({ ok: true, user });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  PLAYLISTS
// ══════════════════════════════════════════════════════════
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await prisma.playlist.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ playlists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/playlists', async (req, res) => {
  try {
    const { name, url, content } = req.body;
    if (!name)               return res.status(400).json({ error: 'Playlist name required' });
    if (!url && !content)    return res.status(400).json({ error: 'URL or M3U content required' });

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

    const pl = await prisma.playlist.create({
      data: {
        id:           uuidv4(),
        name,
        url:          url || null,
        channelCount,
        categories,
        isActive:     false,
        addedById:    req.user.id,
      },
    });

    req.app.locals.injectPlaylist?.({ name, url, content: m3uText, playlistId: pl.id });
    res.status(201).json({ playlist: pl, channelCount, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/playlists/:id', async (req, res) => {
  try {
    await prisma.playlist.delete({ where: { id: req.params.id } });
    req.app.locals.removePlaylist?.(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/playlists/:id/activate', async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.playlist.updateMany({ data: { isActive: false } }),
      prisma.playlist.update({ where: { id: req.params.id }, data: { isActive: true } }),
    ]);
    const pl = await prisma.playlist.findUnique({ where: { id: req.params.id } });
    res.json({ ok: true, playlist: pl });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Playlist not found' });
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  FAVORITES & HISTORY (admin overview)
// ══════════════════════════════════════════════════════════
router.get('/favorites', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [favorites, total] = await Promise.all([
      prisma.favorite.findMany({
        skip,
        take:    Number(limit),
        orderBy: { addedAt: 'desc' },
        include: { user: { select: { username: true, avatar: true } } },
      }),
      prisma.favorite.count(),
    ]);

    res.json({
      favorites: favorites.map(f => ({
        ...f, group: f.grp,
        userInfo: f.user ? { username: f.user.username, avatar: f.user.avatar } : null,
        user: undefined,
      })),
      total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [history, total] = await Promise.all([
      prisma.watchHistory.findMany({
        skip,
        take:    Number(limit),
        orderBy: { watchedAt: 'desc' },
        include: { user: { select: { username: true, avatar: true } } },
      }),
      prisma.watchHistory.count(),
    ]);

    res.json({
      history: history.map(h => ({
        ...h, group: h.grp,
        userInfo: h.user ? { username: h.user.username, avatar: h.user.avatar } : null,
        user: undefined,
      })),
      total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  CHANNELS (read from in-memory IPTV store)
// ══════════════════════════════════════════════════════════
router.get('/channels', (req, res) => {
  const getChannels = req.app.locals.getActiveChannels;
  if (!getChannels) return res.json({ channels: [], total: 0 });

  const { q, category, page = 1, limit = 100 } = req.query;
  let list = getChannels();
  if (category && category !== 'all') list = list.filter(c => c.group === category);
  if (q) { const ql = q.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(ql)); }

  res.json({
    channels: list.slice((Number(page) - 1) * Number(limit), Number(page) * Number(limit)),
    total:    list.length,
  });
});

// ── Helper ────────────────────────────────────────────────
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
  const categories = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, c]) => ({ name, count: c }));
  return { channelCount: count, categories };
}

module.exports = router;
