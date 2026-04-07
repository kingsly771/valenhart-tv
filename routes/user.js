const express  = require('express');
const router   = express.Router();
const { protect } = require('../middleware/auth');
const { getDB }   = require('../config/db');

// GET /api/user/favorites
router.get('/favorites', protect, (req, res) => {
  try {
    const favs = getDB().prepare('SELECT * FROM favorites WHERE user_id=? ORDER BY added_at DESC').all(req.user.id);
    res.json({ favorites: favs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/user/favorites
router.post('/favorites', protect, (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;
    getDB().prepare(`
      INSERT INTO favorites (user_id,channel_id,channel_name,stream_url,logo,grp)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id,channel_id) DO UPDATE SET channel_name=excluded.channel_name
    `).run(req.user.id, channelId, channelName, streamUrl, logo, group);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/user/favorites/:channelId
router.delete('/favorites/:channelId', protect, (req, res) => {
  try {
    getDB().prepare('DELETE FROM favorites WHERE user_id=? AND channel_id=?').run(req.user.id, req.params.channelId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/user/history
router.get('/history', protect, (req, res) => {
  try {
    const history = getDB().prepare('SELECT * FROM history WHERE user_id=? ORDER BY watched_at DESC LIMIT 100').all(req.user.id);
    res.json({ history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/user/history
router.post('/history', protect, (req, res) => {
  try {
    const { channelId, channelName, streamUrl, logo, group } = req.body;
    const db = getDB();
    db.prepare('INSERT INTO history (user_id,channel_id,channel_name,stream_url,logo,grp) VALUES (?,?,?,?,?,?)').run(req.user.id, channelId, channelName, streamUrl, logo, group);
    // Trim to 200 per user
    db.prepare(`DELETE FROM history WHERE user_id=? AND id NOT IN (SELECT id FROM history WHERE user_id=? ORDER BY watched_at DESC LIMIT 200)`).run(req.user.id, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/user/history
router.delete('/history', protect, (req, res) => {
  try {
    getDB().prepare('DELETE FROM history WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
