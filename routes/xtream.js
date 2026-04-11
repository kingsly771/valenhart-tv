/**
 * VALENHART TV v8 — Xtream Codes API Routes
 *
 * POST /api/xtream/connect          — authenticate & save account
 * GET  /api/xtream/accounts         — list saved accounts
 * DELETE /api/xtream/accounts/:key  — remove account
 *
 * All data routes (require ?host=&username=&password= or saved key):
 * GET  /api/xtream/account-info
 * GET  /api/xtream/live/categories
 * GET  /api/xtream/live/streams[?category_id=]
 * GET  /api/xtream/live/epg/:streamId
 * GET  /api/xtream/live/epg-full/:streamId
 * GET  /api/xtream/vod/categories
 * GET  /api/xtream/vod/streams[?category_id=]
 * GET  /api/xtream/vod/info/:vodId
 * GET  /api/xtream/series/categories
 * GET  /api/xtream/series[?category_id=]
 * GET  /api/xtream/series/info/:seriesId
 * GET  /api/xtream/catchup/url      — get timeshift URL
 * GET  /api/xtream/stream-url       — get proxied stream URL info
 */

const express = require('express');
const router  = express.Router();
const { getService, removeService, listAccounts } = require('../services/xtream.service');

// ── In-memory saved accounts (persists for server lifetime) ──
// For full persistence, save to PostgreSQL via Prisma
const _saved = new Map(); // key → { host, port, username, password, useHttps, label, connectedAt }

// ── Middleware: resolve xtream service from request ────────
function resolveService(req, res, next) {
  // Accept credentials from query params OR saved account key
  const { host, username, password, port = 80, https: useHttps, key } = req.query;

  if (key && _saved.has(key)) {
    const acc = _saved.get(key);
    req.xtream = getService(acc.host, acc.username, acc.password, acc.port, acc.useHttps);
    return next();
  }

  if (host && username && password) {
    req.xtream = getService(host, username, password, parseInt(port), useHttps === 'true');
    return next();
  }

  return res.status(400).json({ error: 'Provide Xtream credentials: host, username, password (or saved account key)' });
}

// ══════════════════════════════════════════════════════════
//  ACCOUNT MANAGEMENT
// ══════════════════════════════════════════════════════════

// POST /api/xtream/connect
router.post('/connect', async (req, res) => {
  try {
    const { host, port = 80, username, password, label = '', useHttps = false } = req.body;
    if (!host || !username || !password)
      return res.status(400).json({ error: 'host, username and password are required' });

    const svc  = getService(host, username, password, parseInt(port), useHttps);
    const info = await svc.getAccountInfo();

    if (!info || !info.user_info)
      return res.status(401).json({ error: 'Invalid Xtream credentials — server rejected them' });

    const key = `${host}:${username}`;
    _saved.set(key, {
      host, port: parseInt(port), username, password, useHttps,
      label: label || `${username}@${host}`,
      connectedAt: new Date().toISOString(),
    });

    res.json({
      ok:   true,
      key,
      info: sanitizeAccountInfo(info),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xtream/accounts
router.get('/accounts', (req, res) => {
  const accounts = [..._saved.entries()].map(([key, acc]) => ({
    key,
    label:       acc.label,
    host:        acc.host,
    username:    acc.username,
    connectedAt: acc.connectedAt,
  }));
  res.json({ accounts });
});

// DELETE /api/xtream/accounts/:key
router.delete('/accounts/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!_saved.has(key)) return res.status(404).json({ error: 'Account not found' });
  const acc = _saved.get(key);
  removeService(acc.host, acc.username);
  _saved.delete(key);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════
//  ACCOUNT INFO
// ══════════════════════════════════════════════════════════
router.get('/account-info', resolveService, async (req, res) => {
  try {
    const info = await req.xtream.getAccountInfo();
    res.json(sanitizeAccountInfo(info));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  LIVE STREAMS
// ══════════════════════════════════════════════════════════
router.get('/live/categories', resolveService, async (req, res) => {
  try {
    const cats = await req.xtream.getLiveCategories();
    res.json({ categories: cats || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live/streams', resolveService, async (req, res) => {
  try {
    const { category_id, q, page = 1, limit = 200 } = req.query;
    let streams = await req.xtream.getLiveStreams(category_id || '');

    if (q) {
      const ql = q.toLowerCase();
      streams = streams.filter(s =>
        (s.name || '').toLowerCase().includes(ql) ||
        (s.category_name || '').toLowerCase().includes(ql)
      );
    }

    const total = streams.length;
    const off   = (parseInt(page) - 1) * parseInt(limit);
    const slice = streams.slice(off, off + parseInt(limit));

    // Normalise to app channel format
    const channels = slice.map(s => normalizeStream(s, req.xtream));
    res.json({ channels, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live/epg/:streamId', resolveService, async (req, res) => {
  try {
    const epg = await req.xtream.getShortEPG(req.params.streamId, req.query.limit || 8);
    res.json(epg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live/epg-full/:streamId', resolveService, async (req, res) => {
  try {
    const epg = await req.xtream.getFullEPG(req.params.streamId);
    res.json(epg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  VOD
// ══════════════════════════════════════════════════════════
router.get('/vod/categories', resolveService, async (req, res) => {
  try {
    const cats = await req.xtream.getVODCategories();
    res.json({ categories: cats || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vod/streams', resolveService, async (req, res) => {
  try {
    const { category_id, q, page = 1, limit = 100, sort = 'name' } = req.query;
    let streams = await req.xtream.getVODStreams(category_id || '');

    if (q) {
      const ql = q.toLowerCase();
      streams = streams.filter(s =>
        (s.name || '').toLowerCase().includes(ql) ||
        (s.category_name || '').toLowerCase().includes(ql)
      );
    }

    // Sort
    if (sort === 'name')   streams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sort === 'rating') streams.sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
    if (sort === 'added')  streams.sort((a, b) => parseInt(b.added || 0) - parseInt(a.added || 0));

    const total = streams.length;
    const off   = (parseInt(page) - 1) * parseInt(limit);
    const slice = streams.slice(off, off + parseInt(limit));

    const items = slice.map(s => normalizeVOD(s, req.xtream));
    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vod/info/:vodId', resolveService, async (req, res) => {
  try {
    const info = await req.xtream.getVODInfo(req.params.vodId);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  SERIES
// ══════════════════════════════════════════════════════════
router.get('/series/categories', resolveService, async (req, res) => {
  try {
    const cats = await req.xtream.getSeriesCategories();
    res.json({ categories: cats || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/series', resolveService, async (req, res) => {
  try {
    const { category_id, q, page = 1, limit = 100 } = req.query;
    let series = await req.xtream.getSeries(category_id || '');

    if (q) {
      const ql = q.toLowerCase();
      series = series.filter(s => (s.name || '').toLowerCase().includes(ql));
    }

    const total = series.length;
    const off   = (parseInt(page) - 1) * parseInt(limit);
    const slice = series.slice(off, off + parseInt(limit));

    res.json({ series: slice.map(s => normalizeSeries(s)), total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/series/info/:seriesId', resolveService, async (req, res) => {
  try {
    const info = await req.xtream.getSeriesInfo(req.params.seriesId);
    if (!info || !info.info) return res.status(404).json({ error: 'Series not found' });

    // Flatten episodes by season
    const seasons = {};
    if (info.episodes) {
      Object.entries(info.episodes).forEach(([seasonNum, episodes]) => {
        seasons[seasonNum] = episodes.map(ep => ({
          id:        ep.id,
          episodeNum: ep.episode_num,
          title:     ep.title,
          info:      ep.info,
          url:       req.xtream.getSeriesEpisodeUrl(ep.id, ep.container_extension || 'mkv'),
          duration:  ep.info?.duration_secs || 0,
          thumbnail: ep.info?.movie_image || '',
          added:     ep.added,
        }));
      });
    }

    res.json({
      info:    info.info,
      seasons,
      seriesId: req.params.seriesId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  CATCHUP / TIMESHIFT
// ══════════════════════════════════════════════════════════
router.get('/catchup/url', resolveService, async (req, res) => {
  try {
    const { stream_id, start, duration = 60, ext = 'ts' } = req.query;
    if (!stream_id || !start)
      return res.status(400).json({ error: 'stream_id and start are required' });

    const url = req.xtream.getCatchupUrl(stream_id, start, parseInt(duration), ext);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  SEARCH (cross-type)
// ══════════════════════════════════════════════════════════
router.get('/search', resolveService, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q) return res.json({ results: [] });
    const ql = q.toLowerCase();

    const results = [];

    if (type === 'all' || type === 'live') {
      const streams = await req.xtream.getLiveStreams('');
      streams.filter(s => (s.name || '').toLowerCase().includes(ql)).slice(0, 10).forEach(s => {
        results.push({ type: 'live', ...normalizeStream(s, req.xtream) });
      });
    }

    if (type === 'all' || type === 'vod') {
      const vods = await req.xtream.getVODStreams('');
      vods.filter(s => (s.name || '').toLowerCase().includes(ql)).slice(0, 10).forEach(s => {
        results.push({ type: 'vod', ...normalizeVOD(s, req.xtream) });
      });
    }

    if (type === 'all' || type === 'series') {
      const series = await req.xtream.getSeries('');
      series.filter(s => (s.name || '').toLowerCase().includes(ql)).slice(0, 10).forEach(s => {
        results.push({ type: 'series', ...normalizeSeries(s) });
      });
    }

    res.json({ results: results.slice(0, 30) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════

function normalizeStream(s, svc) {
  return {
    id:          String(s.stream_id),
    name:        s.name || 'Unknown',
    group:       s.category_name || s.category_id || 'Live',
    logo:        s.stream_icon || '',
    url:         svc.getLiveStreamUrl(s.stream_id, 'ts'),
    urlM3u8:     svc.getLiveStreamUrl(s.stream_id, 'm3u8'),
    epgId:       s.epg_channel_id || '',
    streamId:    s.stream_id,
    categoryId:  s.category_id || '',
    tvArchive:   s.tv_archive === 1 || s.tv_archive === '1',
    tvArchiveDuration: parseInt(s.tv_archive_duration || 0),
    added:       s.added || '',
    isLive:      true,
  };
}

function normalizeVOD(s, svc) {
  return {
    id:          String(s.stream_id),
    name:        s.name || 'Unknown',
    group:       s.category_name || s.category_id || 'Movies',
    logo:        s.stream_icon || s.cover || '',
    url:         svc.getVODStreamUrl(s.stream_id, s.container_extension || 'mp4'),
    streamId:    s.stream_id,
    categoryId:  s.category_id || '',
    rating:      s.rating || '',
    rating5:     s.rating_5based || '',
    duration:    s.info?.duration || '',
    releaseDate: s.info?.releasedate || s.added || '',
    plot:        s.info?.plot || '',
    genre:       s.info?.genre || s.category_name || '',
    cast:        s.info?.cast || '',
    director:    s.info?.director || '',
    trailer:     s.info?.youtube_trailer || '',
    isVOD:       true,
  };
}

function normalizeSeries(s) {
  return {
    id:          String(s.series_id),
    name:        s.name || 'Unknown',
    group:       s.category_name || s.category_id || 'Series',
    logo:        s.cover || '',
    seriesId:    s.series_id,
    categoryId:  s.category_id || '',
    rating:      s.rating || '',
    plot:        s.plot || '',
    cast:        s.cast || '',
    director:    s.director || '',
    genre:       s.genre || '',
    releaseDate: s.releaseDate || '',
    lastModified: s.last_modified || '',
    isSeries:    true,
  };
}

function sanitizeAccountInfo(info) {
  if (!info) return {};
  const u = info.user_info || {};
  const s = info.server_info || {};
  return {
    username:      u.username,
    status:        u.status,
    expDate:       u.exp_date ? new Date(parseInt(u.exp_date) * 1000).toISOString() : null,
    isTrial:       u.is_trial === '1',
    activeConn:    parseInt(u.active_cons || 0),
    maxConn:       parseInt(u.max_connections || 1),
    allowedOutputs: u.allowed_output_formats || [],
    serverUrl:     s.url ? `${s.https_port ? 'https' : 'http'}://${s.url}:${s.port || 80}` : '',
    timezone:      s.timezone || '',
    timestampNow:  s.timestamp_now || '',
  };
}

module.exports = router;
