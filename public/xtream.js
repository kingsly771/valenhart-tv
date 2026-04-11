/**
 * VALENHART TV v8 — Xtream Codes Frontend Module
 * Handles all Xtream account management, Live/VOD/Series browsing,
 * EPG display, Catchup, and Series episode browser.
 */

window.XTREAM = (() => {
'use strict';

// ── State ────────────────────────────────────────────────
const X = {
  accounts:         [],    // [{key, label, host, username, connectedAt}]
  activeKey:        localStorage.getItem('vhx_active_key') || null,
  liveCategories:   [],
  vodCategories:    [],
  seriesCategories: [],
  currentSection:   'live',  // live | vod | series
  currentCatId:     '',
  currentCatName:   'All',
  liveChannels:     [],
  vodItems:         [],
  seriesItems:      [],
  livePage:         1,
  vodPage:          1,
  seriesPage:       1,
  liveTotal:        0,
  vodTotal:         0,
  seriesTotal:      0,
  PAGE_LIMIT:       100,
  searchQuery:      '',
  sortVOD:          'name',  // name | rating | added
  currentSeries:    null,    // series info being browsed
  currentSeason:    '1',
  epgCache:         {},      // streamId → epg data
};

// ── Credential storage (sessionStorage for security) ──────
function saveCreds(creds) {
  try { sessionStorage.setItem('vhx_creds', JSON.stringify(creds)); } catch {}
}
function loadCreds() {
  try { return JSON.parse(sessionStorage.getItem('vhx_creds') || 'null'); } catch { return null; }
}

// ── API call helper using the backend proxy ───────────────
async function xapi(path, params = {}, method = 'GET', body = null) {
  const creds = loadCreds();
  const qp    = new URLSearchParams(params);

  // Attach active account credentials
  if (X.activeKey) {
    qp.set('key', X.activeKey);
  } else if (creds) {
    qp.set('host',     creds.host);
    qp.set('username', creds.username);
    qp.set('password', creds.password);
    if (creds.port)     qp.set('port',   creds.port);
    if (creds.useHttps) qp.set('https',  'true');
  }

  const url  = `/api/xtream/${path}?${qp}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════
//  ACCOUNT CONNECTION
// ══════════════════════════════════════════════════════════
async function connect(host, username, password, port = 80, useHttps = false, label = '') {
  const res = await fetch('/api/xtream/connect', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ host, username, password, port, useHttps, label }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Connection failed');

  // Cache credentials in sessionStorage (not localStorage — avoid persisting passwords)
  saveCreds({ host, username, password, port, useHttps });
  X.activeKey = data.key;
  localStorage.setItem('vhx_active_key', data.key);

  return data;
}

async function loadAccounts() {
  try {
    const data = await fetch('/api/xtream/accounts').then(r => r.json());
    X.accounts = data.accounts || [];
    renderAccountList();
  } catch (e) {
    X.accounts = [];
  }
}

async function removeAccount(key) {
  await fetch(`/api/xtream/accounts/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (X.activeKey === key) { X.activeKey = null; localStorage.removeItem('vhx_active_key'); }
  await loadAccounts();
  toast('Account removed', 'info');
}

function switchAccount(key) {
  X.activeKey = key;
  localStorage.setItem('vhx_active_key', key);
  X.liveCategories = []; X.vodCategories = []; X.seriesCategories = [];
  X.liveChannels = []; X.vodItems = []; X.seriesItems = [];
  renderAccountList();
  init();
  toast('Switched account', 'info');
}

// ══════════════════════════════════════════════════════════
//  INIT — load categories and first batch of channels
// ══════════════════════════════════════════════════════════
async function init() {
  if (!X.activeKey && !loadCreds()) {
    renderConnectPrompt();
    return;
  }
  showLoading('Loading Xtream account…');
  try {
    const [liveCats, vodCats, seriesCats, accountInfo] = await Promise.all([
      xapi('live/categories').then(d => d.categories || []).catch(() => []),
      xapi('vod/categories').then(d => d.categories || []).catch(() => []),
      xapi('series/categories').then(d => d.categories || []).catch(() => []),
      xapi('account-info').catch(() => null),
    ]);
    X.liveCategories   = liveCats;
    X.vodCategories    = vodCats;
    X.seriesCategories = seriesCats;
    renderAccountBadge(accountInfo);
    await loadSection('live');
    hideLoading();
  } catch (err) {
    hideLoading();
    renderError(err.message);
  }
}

// ══════════════════════════════════════════════════════════
//  SECTION LOADING
// ══════════════════════════════════════════════════════════
async function loadSection(section, catId = '', catName = 'All', reset = true) {
  X.currentSection = section;
  X.currentCatId   = catId;
  X.currentCatName = catName;
  if (reset) {
    if (section === 'live')   { X.livePage = 1;   X.liveChannels = []; }
    if (section === 'vod')    { X.vodPage = 1;    X.vodItems = []; }
    if (section === 'series') { X.seriesPage = 1; X.seriesItems = []; }
  }

  renderCategoryPanel();
  showContentLoading();

  try {
    if (section === 'live') {
      const data = await xapi('live/streams', { category_id: catId, page: X.livePage, limit: X.PAGE_LIMIT, q: X.searchQuery });
      if (reset) X.liveChannels = data.channels || [];
      else X.liveChannels.push(...(data.channels || []));
      X.liveTotal = data.total || 0;
      renderLiveGrid();
    } else if (section === 'vod') {
      const data = await xapi('vod/streams', { category_id: catId, page: X.vodPage, limit: X.PAGE_LIMIT, q: X.searchQuery, sort: X.sortVOD });
      if (reset) X.vodItems = data.items || [];
      else X.vodItems.push(...(data.items || []));
      X.vodTotal = data.total || 0;
      renderVODGrid();
    } else if (section === 'series') {
      const data = await xapi('series', { category_id: catId, page: X.seriesPage, limit: X.PAGE_LIMIT, q: X.searchQuery });
      if (reset) X.seriesItems = data.series || [];
      else X.seriesItems.push(...(data.series || []));
      X.seriesTotal = data.total || 0;
      renderSeriesGrid();
    }
  } catch (err) {
    renderError(err.message);
  }
}

async function loadMore() {
  if (X.currentSection === 'live')   X.livePage++;
  if (X.currentSection === 'vod')    X.vodPage++;
  if (X.currentSection === 'series') X.seriesPage++;
  await loadSection(X.currentSection, X.currentCatId, X.currentCatName, false);
}

// ══════════════════════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════════════════════
const _searchDebounce = debounce(async (q) => {
  X.searchQuery = q;
  await loadSection(X.currentSection, X.currentCatId, X.currentCatName, true);
}, 400);

function handleSearch(e) {
  _searchDebounce(e.target.value.trim());
}

// ══════════════════════════════════════════════════════════
//  EPG
// ══════════════════════════════════════════════════════════
async function loadEPG(streamId, targetEl) {
  if (X.epgCache[streamId]) {
    renderEPGPopup(X.epgCache[streamId], targetEl);
    return;
  }
  targetEl.textContent = '⌛';
  try {
    const data = await xapi(`live/epg/${streamId}`, { limit: 6 });
    X.epgCache[streamId] = data;
    renderEPGPopup(data, targetEl);
  } catch {
    targetEl.textContent = '—';
  }
}

function renderEPGPopup(data, targetEl) {
  const epgList = data?.epg_listings || [];
  if (!epgList.length) { targetEl.textContent = '—'; return; }
  const current = epgList[0];
  const title   = atob(current.title || '') || current.title || '—';
  targetEl.textContent = title;
  targetEl.title = epgList.map(e => {
    try { return `${e.start_timestamp ? new Date(e.start_timestamp*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''} ${atob(e.title||'')}`.trim(); }
    catch { return e.title || ''; }
  }).join('\n');
}

// ══════════════════════════════════════════════════════════
//  SERIES BROWSER
// ══════════════════════════════════════════════════════════
async function openSeries(seriesId, seriesName) {
  showLoading(`Loading ${seriesName}…`);
  try {
    const info = await xapi(`series/info/${seriesId}`);
    X.currentSeries = info;
    X.currentSeason = Object.keys(info.seasons || {})[0] || '1';
    hideLoading();
    renderSeriesDetail(info);
  } catch (err) {
    hideLoading();
    toast('Failed to load series: ' + err.message, 'err');
  }
}

function selectSeason(seasonNum) {
  X.currentSeason = seasonNum;
  if (!X.currentSeries) return;
  renderSeasonEpisodes(X.currentSeries, seasonNum);
  document.querySelectorAll('.xst-season-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.season === seasonNum);
  });
}

// ══════════════════════════════════════════════════════════
//  VOD DETAIL MODAL
// ══════════════════════════════════════════════════════════
async function openVODDetail(item) {
  const modal = document.getElementById('xtream-vod-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const body = document.getElementById('xvm-body');
  body.innerHTML = `<div class="xvm-loading">⌛ Loading info…</div>`;

  try {
    const info = await xapi(`vod/info/${item.streamId}`);
    const i    = info.info || {};
    body.innerHTML = `
      <div class="xvm-layout">
        <div class="xvm-poster">
          ${item.logo || i.movie_image
            ? `<img src="${esc(item.logo || i.movie_image)}" onerror="this.style.display='none'">`
            : `<div class="xvm-no-poster">🎬</div>`}
        </div>
        <div class="xvm-info">
          <div class="xvm-title">${esc(item.name)}</div>
          <div class="xvm-meta">
            ${i.releasedate ? `<span>📅 ${esc(i.releasedate)}</span>` : ''}
            ${i.duration    ? `<span>⏱ ${esc(i.duration)}</span>` : ''}
            ${item.rating   ? `<span>⭐ ${esc(item.rating)}/10</span>` : ''}
            ${i.genre       ? `<span>🎭 ${esc(i.genre)}</span>` : ''}
            ${i.director    ? `<span>🎬 ${esc(i.director)}</span>` : ''}
          </div>
          ${i.plot ? `<div class="xvm-plot">${esc(i.plot)}</div>` : ''}
          ${i.cast ? `<div class="xvm-cast"><strong>Cast:</strong> ${esc(i.cast)}</div>` : ''}
          <div class="xvm-actions">
            <button class="btn-primary" onclick="XTREAM.playVOD(${JSON.stringify(item).replace(/"/g, '&quot;')})">▶ PLAY NOW</button>
            ${i.youtube_trailer ? `<button class="btn-ghost" onclick="window.open('https://youtube.com/watch?v=${esc(i.youtube_trailer)}','_blank')">🎥 TRAILER</button>` : ''}
            <button class="btn-ghost" onclick="document.getElementById('xtream-vod-modal').style.display='none'">CLOSE</button>
          </div>
        </div>
      </div>
    `;
  } catch {
    body.innerHTML = `
      <div class="xvm-info">
        <div class="xvm-title">${esc(item.name)}</div>
        <div class="xvm-actions">
          <button class="btn-primary" onclick="XTREAM.playVOD(${JSON.stringify(item).replace(/"/g, '&quot;')})">▶ PLAY NOW</button>
          <button class="btn-ghost" onclick="document.getElementById('xtream-vod-modal').style.display='none'">CLOSE</button>
        </div>
      </div>`;
  }
}

function playVOD(item) {
  document.getElementById('xtream-vod-modal').style.display = 'none';
  // Inject into APP player
  const ch = {
    id:    `xtream_vod_${item.streamId}`,
    name:  item.name,
    group: item.group,
    logo:  item.logo,
    url:   item.url,
    prog:  item.releaseDate || '',
    quality: '',
    isVOD: true,
  };
  if (window.APP) window.APP.openChannelDirect(ch);
}

function playEpisode(episode, seriesName) {
  const ch = {
    id:    `xtream_ep_${episode.id}`,
    name:  `${seriesName} S${X.currentSeason}E${episode.episodeNum}: ${episode.title}`,
    group: 'Series',
    logo:  episode.thumbnail || '',
    url:   episode.url,
    prog:  episode.title,
    quality: '',
  };
  if (window.APP) window.APP.openChannelDirect(ch);
}

function playLive(channel) {
  if (window.APP) window.APP.openChannelDirect(channel);
}

// ══════════════════════════════════════════════════════════
//  CATCHUP
// ══════════════════════════════════════════════════════════
async function playCatchup(streamId, startISO, durationMin, name) {
  showLoading('Loading catchup stream…');
  try {
    const data = await xapi('catchup/url', { stream_id: streamId, start: startISO, duration: durationMin });
    hideLoading();
    const ch = {
      id:    `xtream_cu_${streamId}_${Date.now()}`,
      name:  `📺 Catchup: ${name}`,
      group: 'Catchup',
      logo:  '',
      url:   data.url,
      prog:  `Started ${new Date(startISO).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`,
      quality: '',
    };
    if (window.APP) window.APP.openChannelDirect(ch);
  } catch (err) {
    hideLoading();
    toast('Catchup failed: ' + err.message, 'err');
  }
}

// ══════════════════════════════════════════════════════════
//  RENDER — Connect Prompt
// ══════════════════════════════════════════════════════════
function renderConnectPrompt() {
  const cont = document.getElementById('xtream-content');
  if (!cont) return;
  cont.innerHTML = `
    <div class="xc-connect-wrap">
      <div class="xc-connect-box">
        <div class="xc-logo">📡</div>
        <div class="xc-title">CONNECT XTREAM ACCOUNT</div>
        <div class="xc-sub">// ENTER YOUR XTREAM CODES / XTREAM UI CREDENTIALS //</div>

        <div class="xc-form">
          <div class="xc-field">
            <label>SERVER HOST</label>
            <input type="text" id="xc-host" placeholder="e.g. iptv-provider.com" autocomplete="off">
          </div>
          <div class="xc-field-row">
            <div class="xc-field">
              <label>PORT</label>
              <input type="number" id="xc-port" value="80" style="width:80px">
            </div>
            <div class="xc-field" style="flex:1">
              <label>USERNAME</label>
              <input type="text" id="xc-user" autocomplete="username">
            </div>
          </div>
          <div class="xc-field">
            <label>PASSWORD</label>
            <input type="password" id="xc-pass" autocomplete="current-password">
          </div>
          <div class="xc-field">
            <label>LABEL (optional)</label>
            <input type="text" id="xc-label" placeholder="My IPTV">
          </div>
          <div class="xc-field-row" style="align-items:center;gap:12px">
            <label style="display:flex;align-items:center;gap:8px;font-size:.72rem;cursor:pointer">
              <input type="checkbox" id="xc-https"> USE HTTPS
            </label>
          </div>
          <div id="xc-err" class="xc-err" style="display:none"></div>
          <button class="btn-primary xc-submit" id="xc-submit-btn" onclick="XTREAM.submitConnect()">
            ⬡ CONNECT
          </button>
        </div>

        ${X.accounts.length ? `
          <div class="xc-saved-title">SAVED ACCOUNTS</div>
          <div class="xc-saved-list" id="xc-saved-list"></div>
        ` : ''}
      </div>
    </div>
  `;
  renderAccountList();
}

function renderAccountList() {
  const list = document.getElementById('xc-saved-list');
  if (!list || !X.accounts.length) return;
  list.innerHTML = X.accounts.map(acc => `
    <div class="xc-saved-item ${acc.key === X.activeKey ? 'active' : ''}">
      <div class="xcs-icon">📡</div>
      <div class="xcs-info">
        <div class="xcs-label">${esc(acc.label || acc.host)}</div>
        <div class="xcs-meta">${esc(acc.username)}@${esc(acc.host)}</div>
      </div>
      <div class="xcs-actions">
        <button class="btn-ghost" onclick="XTREAM.switchAccount('${esc(acc.key)}')">USE</button>
        <button class="btn-ghost" onclick="XTREAM.removeAccount('${esc(acc.key)}')">✕</button>
      </div>
    </div>
  `).join('');
}

async function submitConnect() {
  const btn  = document.getElementById('xc-submit-btn');
  const err  = document.getElementById('xc-err');
  const host = document.getElementById('xc-host')?.value.trim();
  const port = parseInt(document.getElementById('xc-port')?.value || 80);
  const user = document.getElementById('xc-user')?.value.trim();
  const pass = document.getElementById('xc-pass')?.value;
  const label = document.getElementById('xc-label')?.value.trim();
  const https = document.getElementById('xc-https')?.checked;

  if (!host || !user || !pass) {
    err.textContent = 'All fields required'; err.style.display = 'block'; return;
  }
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'CONNECTING…';

  try {
    const data = await connect(host, user, pass, port, https, label);
    btn.textContent = '✅ CONNECTED';
    toast(`Connected: ${data.info?.username || user}`, 'success');
    await loadAccounts();
    await init();
  } catch (e) {
    err.textContent = e.message; err.style.display = 'block';
    btn.disabled = false; btn.textContent = '⬡ CONNECT';
  }
}

function renderAccountBadge(info) {
  const badge = document.getElementById('xtream-account-badge');
  if (!badge || !info) return;
  const exp   = info.expDate ? new Date(info.expDate) : null;
  const daysLeft = exp ? Math.ceil((exp - Date.now()) / 86400000) : null;
  badge.innerHTML = `
    <div class="xab-user">📡 ${esc(info.username || '—')}</div>
    <div class="xab-status ${info.status === 'Active' ? 'ok' : 'warn'}">
      ${info.status || '—'}
    </div>
    ${daysLeft !== null ? `<div class="xab-exp">${daysLeft > 0 ? `${daysLeft}d left` : 'EXPIRED'}</div>` : ''}
    <div class="xab-conn">${info.activeConn}/${info.maxConn} conn</div>
    <button class="xab-logout btn-ghost" onclick="XTREAM.disconnect()">✕</button>
  `;
  badge.style.display = 'flex';
}

function disconnect() {
  X.activeKey = null; localStorage.removeItem('vhx_active_key');
  try { sessionStorage.removeItem('vhx_creds'); } catch {}
  const badge = document.getElementById('xtream-account-badge');
  if (badge) badge.style.display = 'none';
  renderConnectPrompt();
  toast('Disconnected from Xtream account', 'info');
}

// ══════════════════════════════════════════════════════════
//  RENDER — Category Panel
// ══════════════════════════════════════════════════════════
function renderCategoryPanel() {
  const panel = document.getElementById('xtream-categories');
  if (!panel) return;

  const cats = X.currentSection === 'live'   ? X.liveCategories
             : X.currentSection === 'vod'    ? X.vodCategories
             : X.seriesCategories;

  panel.innerHTML = `
    <div class="xcat-all ${!X.currentCatId ? 'active' : ''}"
         onclick="XTREAM.loadSection('${X.currentSection}','','All')">
      ALL <span class="xcat-cnt">${X.currentSection === 'live' ? X.liveTotal : X.currentSection === 'vod' ? X.vodTotal : X.seriesTotal}</span>
    </div>
    ${cats.map(c => `
      <div class="xcat-item ${c.category_id === X.currentCatId ? 'active' : ''}"
           onclick="XTREAM.loadSection('${X.currentSection}','${esc(c.category_id)}','${esc(c.category_name)}')">
        ${esc(c.category_name)}
        <span class="xcat-cnt">${c.num || ''}</span>
      </div>
    `).join('')}
  `;
}

// ══════════════════════════════════════════════════════════
//  RENDER — Live Grid
// ══════════════════════════════════════════════════════════
function renderLiveGrid() {
  const cont = document.getElementById('xtream-content');
  if (!cont) return;

  const total = X.liveTotal;
  const showing = X.liveChannels.length;

  cont.innerHTML = `
    <div class="xg-header">
      <div class="xg-count">${showing} / ${total} CHANNELS — ${esc(X.currentCatName.toUpperCase())}</div>
      <div class="xg-search-wrap">
        <input class="xg-search" id="xtream-search" type="text" placeholder="Search channels…"
               value="${esc(X.searchQuery)}" oninput="XTREAM.handleSearch(event)">
      </div>
    </div>
    <div class="xg-live-grid" id="xg-live-grid">
      ${X.liveChannels.map(ch => buildLiveCard(ch)).join('')}
    </div>
    ${showing < total ? `
      <div class="xg-load-more">
        <button class="load-more-btn" onclick="XTREAM.loadMore()">LOAD MORE (${total - showing} remaining)</button>
      </div>
    ` : ''}
  `;
}

function buildLiveCard(ch) {
  const logo = ch.logo;
  return `
    <div class="xl-card" onclick="XTREAM.playLive(${JSON.stringify(ch).replace(/"/g,'&quot;')})">
      <div class="xl-logo">
        ${logo ? `<img src="${esc(logo)}" loading="lazy" onerror="this.style.display='none'">` : `<span class="xl-emoji">📺</span>`}
      </div>
      <div class="xl-info">
        <div class="xl-name">${esc(ch.name)}</div>
        <div class="xl-epg" id="xepg-${esc(ch.streamId)}" data-sid="${esc(ch.streamId)}"
             onmouseenter="XTREAM.loadEPG('${esc(ch.streamId)}', this)">
          ${ch.tvArchive ? '<span class="xl-archive" title="Catchup available">⏮</span>' : ''}
          <span class="xl-prog">—</span>
        </div>
        ${ch.tvArchive ? `
          <button class="xl-catchup" onclick="event.stopPropagation();XTREAM.openCatchupPicker(${ch.streamId},'${esc(ch.name)}')"
                  title="Watch past broadcasts">📅 CATCHUP</button>
        ` : ''}
      </div>
      <div class="xl-live-dot"></div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
//  RENDER — VOD Grid
// ══════════════════════════════════════════════════════════
function renderVODGrid() {
  const cont = document.getElementById('xtream-content');
  if (!cont) return;

  const total   = X.vodTotal;
  const showing = X.vodItems.length;

  cont.innerHTML = `
    <div class="xg-header">
      <div class="xg-count">${showing} / ${total} TITLES — ${esc(X.currentCatName.toUpperCase())}</div>
      <div class="xg-controls">
        <input class="xg-search" id="xtream-search" type="text" placeholder="Search movies…"
               value="${esc(X.searchQuery)}" oninput="XTREAM.handleSearch(event)">
        <select class="xg-sort" onchange="XTREAM.setSortVOD(this.value)">
          <option value="name"   ${X.sortVOD==='name'   ?'selected':''}>A–Z</option>
          <option value="rating" ${X.sortVOD==='rating' ?'selected':''}>Top Rated</option>
          <option value="added"  ${X.sortVOD==='added'  ?'selected':''}>Newest</option>
        </select>
      </div>
    </div>
    <div class="xg-vod-grid" id="xg-vod-grid">
      ${X.vodItems.map(item => buildVODCard(item)).join('')}
    </div>
    ${showing < total ? `
      <div class="xg-load-more">
        <button class="load-more-btn" onclick="XTREAM.loadMore()">LOAD MORE (${total - showing} remaining)</button>
      </div>
    ` : ''}
  `;
}

function buildVODCard(item) {
  return `
    <div class="xv-card" onclick="XTREAM.openVODDetail(${JSON.stringify(item).replace(/"/g,'&quot;')})">
      <div class="xv-poster">
        ${item.logo
          ? `<img src="${esc(item.logo)}" loading="lazy" onerror="this.style.display='none'">`
          : `<span class="xv-no-poster">🎬</span>`}
        <div class="xv-overlay">
          <button class="xv-play-btn" onclick="event.stopPropagation();XTREAM.playVOD(${JSON.stringify(item).replace(/"/g,'&quot;')})">
            <svg viewBox="0 0 12 14" fill="none" width="14" height="14"><path d="M1 1l10 6L1 13V1z" fill="#050a14"/></svg>
          </button>
        </div>
        ${item.rating ? `<div class="xv-rating">⭐ ${parseFloat(item.rating).toFixed(1)}</div>` : ''}
      </div>
      <div class="xv-info">
        <div class="xv-name">${esc(item.name)}</div>
        ${item.releaseDate ? `<div class="xv-year">${esc(item.releaseDate.slice(0,4))}</div>` : ''}
      </div>
    </div>
  `;
}

function setSortVOD(sort) {
  X.sortVOD = sort;
  loadSection('vod', X.currentCatId, X.currentCatName, true);
}

// ══════════════════════════════════════════════════════════
//  RENDER — Series Grid
// ══════════════════════════════════════════════════════════
function renderSeriesGrid() {
  const cont = document.getElementById('xtream-content');
  if (!cont) return;

  const total   = X.seriesTotal;
  const showing = X.seriesItems.length;

  cont.innerHTML = `
    <div class="xg-header">
      <div class="xg-count">${showing} / ${total} SERIES — ${esc(X.currentCatName.toUpperCase())}</div>
      <input class="xg-search" id="xtream-search" type="text" placeholder="Search series…"
             value="${esc(X.searchQuery)}" oninput="XTREAM.handleSearch(event)">
    </div>
    <div class="xg-vod-grid" id="xg-series-grid">
      ${X.seriesItems.map(s => buildSeriesCard(s)).join('')}
    </div>
    ${showing < total ? `
      <div class="xg-load-more">
        <button class="load-more-btn" onclick="XTREAM.loadMore()">LOAD MORE (${total - showing} remaining)</button>
      </div>
    ` : ''}
  `;
}

function buildSeriesCard(s) {
  return `
    <div class="xv-card" onclick="XTREAM.openSeries('${esc(s.seriesId)}','${esc(s.name)}')">
      <div class="xv-poster">
        ${s.logo ? `<img src="${esc(s.logo)}" loading="lazy" onerror="this.style.display='none'">` : `<span class="xv-no-poster">📺</span>`}
        <div class="xv-overlay">
          <button class="xv-play-btn">▶</button>
        </div>
        ${s.rating ? `<div class="xv-rating">⭐ ${parseFloat(s.rating).toFixed(1)}</div>` : ''}
        <div class="xv-series-badge">SERIES</div>
      </div>
      <div class="xv-info">
        <div class="xv-name">${esc(s.name)}</div>
        ${s.genre ? `<div class="xv-year">${esc(s.genre)}</div>` : ''}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
//  RENDER — Series Detail
// ══════════════════════════════════════════════════════════
function renderSeriesDetail(info) {
  const cont = document.getElementById('xtream-content');
  if (!cont) return;
  const i       = info.info || {};
  const seasons = Object.keys(info.seasons || {});

  cont.innerHTML = `
    <div class="xsd-back">
      <button class="btn-ghost" onclick="XTREAM.loadSection('series','${esc(X.currentCatId)}','${esc(X.currentCatName)}')">
        ← BACK TO SERIES
      </button>
    </div>
    <div class="xsd-hero">
      ${i.cover ? `<img class="xsd-cover" src="${esc(i.cover)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="xsd-info">
        <div class="xsd-title">${esc(i.name || '')}</div>
        <div class="xsd-meta">
          ${i.releaseDate ? `<span>📅 ${esc(i.releaseDate)}</span>` : ''}
          ${i.rating      ? `<span>⭐ ${esc(i.rating)}</span>` : ''}
          ${i.genre       ? `<span>🎭 ${esc(i.genre)}</span>` : ''}
          ${i.cast        ? `<span>🎬 ${esc(i.cast.substring(0, 60))}${i.cast.length > 60 ? '…' : ''}</span>` : ''}
        </div>
        ${i.plot ? `<div class="xsd-plot">${esc(i.plot)}</div>` : ''}
      </div>
    </div>

    <div class="xsd-seasons">
      ${seasons.map(s => `
        <button class="xst-season-tab ${s === X.currentSeason ? 'active' : ''}"
                data-season="${esc(s)}" onclick="XTREAM.selectSeason('${esc(s)}')">
          SEASON ${esc(s)}
        </button>
      `).join('')}
    </div>

    <div id="xsd-episodes" class="xsd-episodes">
      ${renderSeasonEpisodesHTML(info, X.currentSeason)}
    </div>
  `;
}

function renderSeasonEpisodesHTML(info, season) {
  const episodes = info.seasons?.[season] || [];
  if (!episodes.length) return `<div class="empty-state"><div class="empty-ico">📺</div><div class="empty-title">NO EPISODES</div></div>`;

  const seriesName = info.info?.name || 'Series';
  return `<div class="xep-grid">${episodes.map(ep => `
    <div class="xep-card" onclick="XTREAM.playEpisode(${JSON.stringify(ep).replace(/"/g,'&quot;')},'${esc(seriesName)}')">
      <div class="xep-thumb">
        ${ep.thumbnail
          ? `<img src="${esc(ep.thumbnail)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="xep-no-thumb">▶</div>`}
      </div>
      <div class="xep-info">
        <div class="xep-num">E${ep.episodeNum}</div>
        <div class="xep-title">${esc(ep.title || `Episode ${ep.episodeNum}`)}</div>
        ${ep.info?.plot ? `<div class="xep-plot">${esc(ep.info.plot.substring(0, 80))}${ep.info.plot.length > 80 ? '…' : ''}</div>` : ''}
        ${ep.duration ? `<div class="xep-dur">⏱ ${Math.round(ep.duration / 60)}min</div>` : ''}
      </div>
      <div class="xep-play">▶</div>
    </div>
  `).join('')}</div>`;
}

function renderSeasonEpisodes(info, season) {
  const el = document.getElementById('xsd-episodes');
  if (el) el.innerHTML = renderSeasonEpisodesHTML(info, season);
}

// ══════════════════════════════════════════════════════════
//  RENDER — Catchup Picker
// ══════════════════════════════════════════════════════════
function openCatchupPicker(streamId, channelName) {
  const modal = document.getElementById('xtream-catchup-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const body = document.getElementById('xcm-body');
  const today = new Date();

  // Generate last 7 days × time slots
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - i); return d;
  });

  body.innerHTML = `
    <div class="xcm-title">📅 CATCHUP — ${esc(channelName)}</div>
    <div class="xcm-days">
      ${days.map(d => {
        const label = d.toDateString() === today.toDateString() ? 'Today'
          : d.toDateString() === new Date(today - 86400000).toDateString() ? 'Yesterday'
          : d.toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' });
        return `<button class="xcm-day-btn" onclick="XTREAM._pickCatchupDay(${streamId},'${esc(channelName)}','${d.toISOString().split('T')[0]}',this)">${label}</button>`;
      }).join('')}
    </div>
    <div id="xcm-times" class="xcm-times"></div>
    <button class="btn-ghost" style="margin-top:14px;align-self:flex-start" onclick="document.getElementById('xtream-catchup-modal').style.display='none'">CLOSE</button>
  `;
}

function _pickCatchupDay(streamId, name, dateStr, btn) {
  document.querySelectorAll('.xcm-day-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const timesEl = document.getElementById('xcm-times');
  if (!timesEl) return;

  // Generate hourly slots for selected day
  const slots = Array.from({ length: 24 }, (_, h) =>
    `${dateStr}T${String(h).padStart(2,'0')}:00:00`
  );

  timesEl.innerHTML = `<div class="xcm-times-label">SELECT START TIME:</div>` +
    slots.map(iso => {
      const d    = new Date(iso);
      const hr   = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<button class="xcm-time-btn"
                onclick="XTREAM.playCatchup(${streamId},'${iso}',60,'${esc(name)}');document.getElementById('xtream-catchup-modal').style.display='none'">
                ${hr}
              </button>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════
//  LOADING / ERROR STATES
// ══════════════════════════════════════════════════════════
function showLoading(msg = 'Loading…') {
  const cont = document.getElementById('xtream-content');
  if (cont) cont.innerHTML = `<div class="xg-loading"><div class="pm-spinner"></div><div class="xg-loading-txt">${esc(msg)}</div></div>`;
}
function showContentLoading() {
  const cont = document.getElementById('xtream-content');
  if (cont) cont.innerHTML = `<div class="xg-loading"><div class="pm-spinner"></div></div>`;
}
function hideLoading() { /* content replaced by render methods */ }
function renderError(msg) {
  const cont = document.getElementById('xtream-content');
  if (cont) cont.innerHTML = `
    <div class="empty-state">
      <div class="empty-ico">⚠</div>
      <div class="empty-title">ERROR</div>
      <div class="empty-sub">${esc(msg)}</div>
      <button class="btn-primary" style="margin-top:16px" onclick="XTREAM.renderConnectPrompt()">RECONNECT</button>
    </div>`;
}

// ══════════════════════════════════════════════════════════
//  SECTION SWITCHER
// ══════════════════════════════════════════════════════════
function switchSection(section) {
  X.currentSection = section;
  X.searchQuery    = '';
  X.currentCatId   = '';
  X.currentCatName = 'All';
  document.querySelectorAll('.xsect-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));
  loadSection(section, '', 'All', true);
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function toast(msg, type = 'info') { window.APP?.toast ? window.APP.toast(msg, type) : console.log(msg); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ══════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════
return {
  init, connect, disconnect, switchAccount, removeAccount, loadAccounts,
  submitConnect, renderConnectPrompt,
  loadSection, loadMore, switchSection,
  handleSearch, setSortVOD,
  loadEPG,
  openSeries, selectSeason, playEpisode,
  openVODDetail, playVOD, playLive,
  openCatchupPicker, playCatchup, _pickCatchupDay,
  // Called by APP after Xtream playlist connect
  _setActiveKey: (key) => { X.activeKey = key; localStorage.setItem('vhx_active_key', key); },
};

})();
