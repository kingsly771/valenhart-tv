/**
 * VALENHART TV — User Routes (SQLite-backed via db.js)
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');

const getStore = (req) => req.app.locals.authStore;
const auth     = (req, res, next) => protect(getStore(req))(req, res, next);

// ── FAVORITES ────────────────────────────────────────
router.get('/favorites', auth, (req, res) => {
  const s    = getStore(req);
  const favs = s.getFavoritesByUser(req.user.id);
  res.json({ favorites: favs });
});

router.post('/favorites', auth, (req, res) => {
  const { channelId, channelName, streamUrl, logo, group } = req.body;
  const s   = getStore(req);
  const fav = {
    id:          String(Date.now()),
    userId:      req.user.id,
    channelId,
    channelName: channelName || '',
    streamUrl:   streamUrl   || '',
    logo:        logo        || '',
    group:       group       || '',
    addedAt:     new Date().toISOString(),
  };
  s.insertFavorite(fav);
  res.json({ ok: true, favorite: fav });
});

router.delete('/favorites/:channelId', auth, (req, res) => {
  const s = getStore(req);
  s.deleteFavorite(req.user.id, req.params.channelId);
  res.json({ ok: true });
});

// ── HISTORY ──────────────────────────────────────────
router.get('/history', auth, (req, res) => {
  const s = getStore(req);
  const h = s.getHistoryByUser(req.user.id, 100);
  res.json({ history: h });
});

router.post('/history', auth, (req, res) => {
  const { channelId, channelName, streamUrl, logo, group } = req.body;
  const s     = getStore(req);
  const entry = {
    id:          String(Date.now()),
    userId:      req.user.id,
    channelId,
    channelName: channelName || '',
    streamUrl:   streamUrl   || '',
    logo:        logo        || '',
    group:       group       || '',
    watchedAt:   new Date().toISOString(),
  };
  s.insertHistory(entry);
  res.json({ ok: true, entry });
});

router.delete('/history', auth, (req, res) => {
  const s = getStore(req);
  if (s._db_deleteUserHistory) s._db_deleteUserHistory(req.user.id);
  else s._mem.history = s._mem.history.filter(h => h.userId !== req.user.id);
  res.json({ ok: true });
});

module.exports = router;
