/**
 * VALENHART TV v8 — Xtream Codes API Service
 *
 * Implements full Xtream Codes / Xtream UI API:
 *  - Account authentication & info
 *  - Live streams + categories
 *  - VOD streams + categories + stream info
 *  - Series + categories + episodes
 *  - Short EPG & full EPG per stream
 *  - Catchup / Timeshift stream URLs
 *  - Panel API (get_account_info)
 */

const fetch = require('node-fetch');

class XtreamService {
  constructor({ host, port = 80, username, password, useHttps = false }) {
    const proto = useHttps ? 'https' : 'http';
    const p     = (useHttps && port === 443) || (!useHttps && port === 80) ? '' : `:${port}`;
    this.base     = `${proto}://${host}${p}`;
    this.username = username;
    this.password = password;
    this._cache   = new Map(); // simple TTL cache
  }

  // ── Internal fetch helper ──────────────────────────────
  async _get(path, params = {}, ttl = 300) {
    const qs  = new URLSearchParams({ username: this.username, password: this.password, ...params });
    const url = `${this.base}/${path}?${qs}`;
    const key = url;

    const cached = this._cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.data;

    const res = await fetch(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16' },
    });
    if (!res.ok) throw new Error(`Xtream API error: HTTP ${res.status}`);

    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      data = await res.json();
    } else {
      // Some servers return plain text / M3U for certain endpoints
      data = await res.text();
    }

    this._cache.set(key, { data, expires: Date.now() + ttl * 1000 });
    return data;
  }

  clearCache() { this._cache.clear(); }

  // ── Account Info ───────────────────────────────────────
  async getAccountInfo() {
    return this._get('player_api.php', { action: 'get_account_info' }, 60);
  }

  // ══════════════════════════════════════════════════════
  //  LIVE STREAMS
  // ══════════════════════════════════════════════════════
  async getLiveCategories() {
    return this._get('player_api.php', { action: 'get_live_categories' }, 300);
  }

  async getLiveStreams(categoryId = '') {
    const params = { action: 'get_live_streams' };
    if (categoryId) params.category_id = categoryId;
    return this._get('player_api.php', params, 120);
  }

  async getLiveStreamsByCategory(categoryId) {
    return this.getLiveStreams(categoryId);
  }

  // Build live stream URL
  getLiveStreamUrl(streamId, ext = 'ts') {
    return `${this.base}/live/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  // ══════════════════════════════════════════════════════
  //  VOD
  // ══════════════════════════════════════════════════════
  async getVODCategories() {
    return this._get('player_api.php', { action: 'get_vod_categories' }, 300);
  }

  async getVODStreams(categoryId = '') {
    const params = { action: 'get_vod_streams' };
    if (categoryId) params.category_id = categoryId;
    return this._get('player_api.php', params, 120);
  }

  async getVODInfo(vodId) {
    return this._get('player_api.php', { action: 'get_vod_info', vod_id: vodId }, 600);
  }

  // Build VOD stream URL
  getVODStreamUrl(streamId, ext = 'mp4') {
    return `${this.base}/movie/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  // ══════════════════════════════════════════════════════
  //  SERIES
  // ══════════════════════════════════════════════════════
  async getSeriesCategories() {
    return this._get('player_api.php', { action: 'get_series_categories' }, 300);
  }

  async getSeries(categoryId = '') {
    const params = { action: 'get_series' };
    if (categoryId) params.category_id = categoryId;
    return this._get('player_api.php', params, 120);
  }

  async getSeriesInfo(seriesId) {
    return this._get('player_api.php', { action: 'get_series_info', series_id: seriesId }, 600);
  }

  // Build series episode URL
  getSeriesEpisodeUrl(streamId, ext = 'mkv') {
    return `${this.base}/series/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  // ══════════════════════════════════════════════════════
  //  EPG
  // ══════════════════════════════════════════════════════
  async getShortEPG(streamId, limit = 8) {
    return this._get('player_api.php', { action: 'get_short_epg', stream_id: streamId, limit }, 60);
  }

  async getFullEPG(streamId) {
    return this._get('player_api.php', { action: 'get_simple_data_table', stream_id: streamId }, 300);
  }

  async getXMLTV() {
    return this._get('xmltv.php', {}, 1800);
  }

  // ══════════════════════════════════════════════════════
  //  CATCHUP / TIMESHIFT
  // ══════════════════════════════════════════════════════
  // Xtream catchup URL format:
  // /timeshift/{user}/{pass}/{duration}/{start}/{stream_id}.ts
  // start format: YYYY-MM-DD:HH-MM
  getCatchupUrl(streamId, startTime, durationMinutes = 60, ext = 'ts') {
    const d = new Date(startTime);
    const start = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}:${pad(d.getHours())}-${pad(d.getMinutes())}`;
    return `${this.base}/timeshift/${this.username}/${this.password}/${durationMinutes}/${start}/${streamId}.${ext}`;
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

// ── Singleton store: one XtreamService per saved account ──
const _accounts = new Map(); // key = `${host}:${username}`

function getService(host, username, password, port = 80, useHttps = false) {
  const key = `${host}:${username}`;
  if (!_accounts.has(key)) {
    _accounts.set(key, new XtreamService({ host, port, username, password, useHttps }));
  }
  return _accounts.get(key);
}

function removeService(host, username) {
  _accounts.delete(`${host}:${username}`);
}

function listAccounts() {
  return [..._accounts.keys()];
}

module.exports = { XtreamService, getService, removeService, listAccounts };
