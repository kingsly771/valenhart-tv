/**
 * VALENHART TV v5 — User Routes (PostgreSQL via Prisma)
 * Favorites + watch history, all JWT-protected.
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { protect } = require('../middleware/auth');
const prisma = require('../db');

// ── FAVORITES ────────────────────────────────────────────

router.get('/favorites', protect, async (req, res) => {
  try {
    const favs = await prisma.favorite.findMany({
      where:   { userId: req.user.id },
      orderBy: { addedAt: 'desc' },
    });
    res.json({ favorites: favs.map(f => ({ ...f, group: f.grp })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/favorites', protect, async (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });

    const fav = await prisma.favorite.upsert({
      where:  { userId_channelId: { userId: req.user.id, channelId } },
      update: { channelName: channelName || '', streamUrl: streamUrl || '', logo: logo || '', grp: group || '' },
      create: {
        id: uuidv4(), userId: req.user.id, channelId,
        channelName: channelName || '', streamUrl: streamUrl || '',
        logo: logo || '', grp: group || '',
      },
    });
    res.json({ ok: true, favorite: { ...fav, group: fav.grp } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/favorites/:channelId', protect, async (req, res) => {
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.user.id, channelId: req.params.channelId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HISTORY ──────────────────────────────────────────────

router.get('/history', protect, async (req, res) => {
  try {
    const history = await prisma.watchHistory.findMany({
      where:   { userId: req.user.id },
      orderBy: { watchedAt: 'desc' },
      take:    100,
    });
    res.json({ history: history.map(h => ({ ...h, group: h.grp })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/history', protect, async (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });

    const entry = await prisma.watchHistory.create({
      data: {
        id: uuidv4(), userId: req.user.id, channelId,
        channelName: channelName || '', streamUrl: streamUrl || '',
        logo: logo || '', grp: group || '',
      },
    });
    res.json({ ok: true, entry: { ...entry, group: entry.grp } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/history', protect, async (req, res) => {
  try {
    await prisma.watchHistory.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
