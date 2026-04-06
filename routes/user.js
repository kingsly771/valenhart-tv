const express  = require('express');
const router   = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const Favorite = require('../models/Favorite');
const History  = require('../models/History');

// ─── FAVORITES ────────────────────────────────────────

// GET /api/user/favorites
router.get('/favorites', protect, async (req, res) => {
  try {
    const favs = await Favorite.find({ userId: req.user._id }).sort({ addedAt: -1 });
    res.json({ favorites: favs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/favorites
router.post('/favorites', protect, async (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;
    const fav = await Favorite.findOneAndUpdate(
      { userId: req.user._id, channelId },
      { userId: req.user._id, channelId, channelName, streamUrl, logo, group },
      { upsert: true, new: true }
    );
    res.json({ ok: true, favorite: fav });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/favorites/:channelId
router.delete('/favorites/:channelId', protect, async (req, res) => {
  try {
    await Favorite.findOneAndDelete({ userId: req.user._id, channelId: req.params.channelId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HISTORY ──────────────────────────────────────────

// GET /api/user/history
router.get('/history', protect, async (req, res) => {
  try {
    const history = await History.find({ userId: req.user._id })
      .sort({ watchedAt: -1 })
      .limit(100);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/history
router.post('/history', protect, async (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;

    const entry = await History.create({
      userId: req.user._id,
      channelId, channelName, streamUrl, logo, group,
      watchedAt: new Date(),
    });

    // Trim to 200 per user
    const count = await History.countDocuments({ userId: req.user._id });
    if (count > 200) {
      const oldest = await History.find({ userId: req.user._id })
        .sort({ watchedAt: 1 })
        .limit(count - 200)
        .select('_id');
      await History.deleteMany({ _id: { $in: oldest.map(o => o._id) } });
    }

    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/user/history — clear all
router.delete('/history', protect, async (req, res) => {
  try {
    await History.deleteMany({ userId: req.user._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
