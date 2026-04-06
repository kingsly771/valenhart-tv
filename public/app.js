/**
 * VALENHART TV v3.0 — Main Application
 * By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗
 *
 * Covers:
 *  - M3U playlist loading (URL + file upload)
 *  - Channel display, search, filtering, pagination
 *  - HLS.js video playback with error handling + proxy fallback
 *  - Favorites (localStorage + Socket.IO)
 *  - Recently watched (localStorage)
 *  - Socket.IO: chat, viewer counts, EPG
 *  - Particles, animations, toasts, settings
 */

const APP = (() => {
'use strict';

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
const S = {
  channels:     [],
  categories:   [],
  viewerCounts: {},
  playlists:    [],
  activePl:     null,
  currentCh:    null,
  currentPage:  'home',
  filterCat:    'all',
  channelPage:  1,
  channelLimit: 120,
  totalChs:     0,

  favorites:    JSON.parse(localStorage.getItem('vhv3_favs')  || '[]'),
  recent:       JSON.parse(localStorage.getItem('vhv3_recent')|| '[]'),

  socket:       null,
  socketId:     null,
  username:     '',
  avatar:       '🎭',

  hlsInstance:  null,
  dashInstance: null,
  flvInstance:  null,
  isPlaying:    false,
  isMuted:      false,
  usingProxy:   false,

  fx: {
    particles: true,
    scanlines: true,
    sfx:       false,
    proxy:     true,
    autoplay:  true,
  },
};

// ═══════════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════════
function initSocket() {
  try {
    const socket = io();
    S.socket = socket;

    socket.on('welcome', ({ username, socketId }) => {
      S.username = username; S.socketId = socketId;
      S.avatar   = randomAvatar();
      el('tb-name').textContent = username;
      el('sb-status').textContent = username;
      el('tb-avatar').textContent = S.avatar;
      socket.emit('get_watchlist');
    });

    socket.on('online_count', n => {
      el('sb-status').textContent = `${n} ONLINE`;
    });

    socket.on('viewer_counts', counts => {
      S.viewerCounts = { ...S.viewerCounts, ...counts };
      updateViewerDisplays();
    });

    socket.on('viewer_join_leave', ({ channelId, count }) => {
      S.viewerCounts[channelId] = count;
      if (S.currentCh?.id === channelId) {
        el('pm-viewer-cnt').textContent = fmtN(count);
        el('chat-cnt').textContent = fmtN(count) + ' viewers';
      }
    });

    socket.on('chat_history', ({ messages }) => {
      el('chat-msgs').innerHTML = '';
      messages.forEach(renderChatMsg);
    });

    socket.on('new_message', ({ msg }) => {
      renderChatMsg(msg);
      const box = el('chat-msgs');
      box.scrollTop = box.scrollHeight;
    });

    socket.on('watchlist_state', (ids) => {
      // Merge server watchlist with local favs
      ids.forEach(id => { if (!S.favorites.includes(id)) S.favorites.push(id); });
      saveFavs();
      renderFavBadge();
    });

    socket.on('watchlist_update', ({ channelId, added }) => {
      if (added) {
        if (!S.favorites.includes(channelId)) S.favorites.push(channelId);
      } else {
        S.favorites = S.favorites.filter(f => f !== channelId);
      }
      saveFavs();
      renderFavBadge();
      document.querySelectorAll(`.ch-fav-btn[data-id="${channelId}"]`).forEach(b => {
        b.classList.toggle('on', added);
        b.title = added ? 'Remove from favorites' : 'Add to favorites';
      });
      toast(added ? '★ Added to favorites' : '☆ Removed from favorites', added ? 'success' : 'info');
      if (S.currentPage === 'favorites') renderFavoritesPage();
    });

    socket.on('rating_update', ({ channelId, up, down }) => {
      if (S.currentCh?.id === channelId) setRatingUI(up, down);
    });

    socket.on('epg_update', epg => renderEPG(epg));

  } catch(e) {
    console.warn('Socket not available — demo mode');
    el('sb-status').textContent = 'DEMO MODE';
  }
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
async function init() {
  loadFxPrefs();
  initSocket();
  startParticles();
  startEPGClock();

  await Promise.all([
    loadPlaylists(),
    loadStats(),
    loadEPG(),
  ]);

  renderHomePage();

  // Search
  const inp = el('search-inp');
  inp.addEventListener('input', debounce(handleSearch, 220));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSearch();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) el('search-dd').classList.remove('show');
  });

  // Chat enter key
  el('chat-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePlayer(); closePlModal(); }
    if (e.key === 'f' && !e.ctrlKey && !e.target.matches('input,textarea') && S.currentCh) toggleFavFromPlayer();
    if (e.key === 'm' && !e.target.matches('input,textarea') && S.currentCh) toggleMute();
  });

  // ── Mobile: tap video screen to toggle controls visibility ──
  let controlsVisible = true;
  let controlsTimer = null;
  function showControls() {
    controlsVisible = true;
    const screen = document.querySelector('.pm-screen');
    if (screen) screen.classList.remove('controls-hidden');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, 3500);
  }
  function hideControls() {
    controlsVisible = false;
    const screen = document.querySelector('.pm-screen');
    if (screen) screen.classList.add('controls-hidden');
  }
  document.querySelector('.pm-screen').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      controlsVisible ? hideControls() : showControls();
    }
  });
  // Auto-hide when player opens on mobile
  document.getElementById('player-modal').addEventListener('transitionend', () => {
    if (window.innerWidth <= 768 && document.getElementById('player-modal').classList.contains('show')) {
      showControls();
    }
  });

  // ── Mobile: swipe down on player to close ──
  let touchStartY = 0;
  document.getElementById('player-modal').addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.getElementById('player-modal').addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 80 && window.innerWidth <= 768) closePlayer();
  }, { passive: true });

  // Page progress bar done
  el('pg-bar').style.width = '100%';
  setTimeout(() => el('pg-bar').style.opacity = '0', 400);
}

// ═══════════════════════════════════════════════════════
//  PLAYLIST LOADING
// ═══════════════════════════════════════════════════════
async function loadPlaylists() {
  try {
    const data = await api('/api/playlists');
    S.playlists = data.playlists || [];
    S.activePl  = data.activeId;
    renderPlTabs();
    if (S.activePl) {
      await loadChannels(true);
    } else {
      updateNoPlaylistState();
    }
  } catch(e) {
    // Server not up — use demo channels
    await loadChannels(true);
  }
}

async function loadChannels(reset = false) {
  if (reset) {
    S.channels     = [];
    S.channelPage  = 1;
  }

  showPageLoader();
  try {
    const params = new URLSearchParams({
      page:  S.channelPage,
      limit: S.channelLimit,
    });
    if (S.filterCat && S.filterCat !== 'all') params.set('category', S.filterCat);

    const data = await api(`/api/channels?${params}`);
    const newChs = data.channels || [];

    if (reset) {
      S.channels = newChs;
    } else {
      S.channels = [...S.channels, ...newChs];
    }

    S.totalChs = data.total || newChs.length;
    S.viewerCounts = { ...S.viewerCounts, ...(data.viewerCounts || {}) };

    // Load categories on first load
    if (reset) await loadCategories();

    renderLivePage();
    renderTrending();
    updateStats();
    updateBadges();
  } catch(e) {
    console.warn('Channel load error:', e);
    // Use embedded demo data
    S.channels = DEMO_CHANNELS;
    S.totalChs = DEMO_CHANNELS.length;
    S.categories = buildLocalCategories(DEMO_CHANNELS);
    DEMO_CHANNELS.forEach(c => {
      S.viewerCounts[c.id] = c.baseViewers + Math.floor(Math.random() * 2000);
    });
    renderLivePage();
    renderTrending();
    updateStats();
  }
}

async function loadCategories() {
  try {
    const data = await api('/api/categories');
    S.categories = data.categories || [];
  } catch(e) {
    S.categories = buildLocalCategories(S.channels);
  }
  renderCategoryPage();
}

async function loadStats() {
  try {
    const d = await api('/api/stats');
    el('tb-viewers').textContent  = fmtN(d.totalViewers);
    el('stat-viewers').textContent = fmtN(d.totalViewers);
    el('stat-chs').textContent    = d.activeChannels || '—';
    el('stat-cats').textContent   = d.categories || '—';
    el('tb-chs').textContent      = d.activeChannels || '—';
  } catch(e) {}
}

async function loadEPG() {
  try {
    const epg = await api('/api/epg');
    renderEPG(epg);
  } catch(e) {}
}

function updateStats() {
  el('stat-chs').textContent  = S.totalChs || S.channels.length;
  el('stat-cats').textContent = S.categories.length;
  el('tb-chs').textContent    = S.totalChs || S.channels.length;
  el('badge-live').textContent = S.totalChs || S.channels.length;
  // Bottom nav live badge
  const bnBadge = el('bnav-badge-live');
  if (bnBadge) {
    const count = S.totalChs || S.channels.length;
    bnBadge.textContent = count > 999 ? '99+' : (count || '');
    bnBadge.style.display = count ? '' : 'none';
  }
}

function updateNoPlaylistState() {
  const hasActive = S.playlists.some(p => p.active) || S.channels.length > 0;
  el('no-playlist-msg').style.display = hasActive ? 'none' : '';
  el('live-main').style.display       = hasActive ? 'block' : 'none';
}

// ── SUBMIT PLAYLIST ─────────────────────────────────────
let plModalMode = 'url';
let fileContent  = null;

async function submitPlaylist() {
  const loading = el('pl-loading');
  const status  = el('pl-status');
  const btn     = el('pl-submit-btn');

  loading.classList.add('show');
  status.textContent = 'Loading...';
  status.className   = 'pl-status';
  btn.disabled       = true;

  try {
    let data;
    if (plModalMode === 'url') {
      const url  = el('pl-url-inp').value.trim();
      const name = el('pl-name-inp').value.trim();
      if (!url) throw new Error('Please enter a URL');
      data = await api('/api/playlist/url', 'POST', { url, name });
    } else {
      if (!fileContent) throw new Error('Please select a file');
      const name = el('pl-file-name-inp').value.trim();
      data = await api('/api/playlist/upload', 'POST', { content: fileContent, name });
    }

    status.textContent = `✅ Loaded ${data.count} channels from "${data.name}"`;
    status.className   = 'pl-status ok';

    S.playlists.push({ id: data.id, name: data.name, count: data.count, active: true });
    S.activePl = data.id;

    await loadChannels(true);
    renderPlTabs();
    renderCategoryPage();

    toast(`✅ ${data.count} channels loaded!`, 'success');
    setTimeout(closePlModal, 1500);
    nav('live');

  } catch(err) {
    status.textContent = '⚠ ' + (err.message || 'Failed to load playlist');
    status.className   = 'pl-status err';
  } finally {
    loading.classList.remove('show');
    btn.disabled = false;
  }
}

function handleFileInput(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    fileContent = e.target.result;
    el('m3u-drop-zone').innerHTML = `
      <div class="m3u-zone-ico">✅</div>
      <div class="m3u-zone-txt">${esc(file.name)}</div>
      <div class="m3u-zone-sub">${(file.size/1024).toFixed(1)} KB · ready to load</div>
    `;
    el('pl-status').textContent = `File "${file.name}" ready`;
    el('pl-status').className   = 'pl-status ok';
  };
  reader.readAsText(file);
}

function handleDrop(e) {
  e.preventDefault();
  el('m3u-drop-zone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer(); dt.items.add(file);
    const inp = el('m3u-file-inp'); inp.files = dt.files;
    handleFileInput(inp);
  }
}

async function activatePlaylist(id) {
  try {
    await api(`/api/playlists/${id}/activate`, 'POST');
    S.activePl = id;
    S.playlists.forEach(p => p.active = p.id === id);
    renderPlTabs();
    S.filterCat = 'all';
    await loadChannels(true);
    toast('Playlist switched', 'info');
  } catch(e) { toast('Failed to switch playlist', 'err'); }
}

async function deletePlaylist(id) {
  try {
    await api(`/api/playlists/${id}`, 'DELETE');
    S.playlists = S.playlists.filter(p => p.id !== id);
    if (S.activePl === id) {
      S.activePl = S.playlists[0]?.id || null;
      await loadChannels(true);
    }
    renderPlTabs();
    toast('Playlist removed', 'info');
  } catch(e) {}
}

async function loadUrlFromSettings() {
  const url  = el('url-input-settings').value.trim();
  const name = el('pl-name-settings').value.trim();
  if (!url) return toast('Enter a URL', 'warn');
  el('pl-url-inp').value  = url;
  el('pl-name-inp').value = name;
  plModalMode = 'url';
  await submitPlaylist();
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════
function renderHomePage() {
  renderRecentRow();
  renderTrending();
  updateHeroFeatured();
}

function updateHeroFeatured() {
  if (!S.channels.length) return;
  const top = S.channels.slice().sort((a,b) =>
    (S.viewerCounts[b.id] || 0) - (S.viewerCounts[a.id] || 0)
  )[0];
  const logo = top.logo || top.emoji || '📺';
  el('hero-ch-disp').innerHTML = `
    ${logo.startsWith('http') ? `<img src="${esc(logo)}" class="hero-ch-logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hero-ch-logo',textContent:'📺'}))">` : `<span class="hero-ch-logo">${esc(logo)}</span>`}
    <div class="hero-ch-name">${esc(top.name)}</div>
    <div class="hero-ch-prog">${esc(top.prog || top.group || 'LIVE')}</div>
  `;
  el('hero-ch-lbl').textContent = top.name;
  el('hero-view-cnt').textContent = '👁 ' + fmtN(S.viewerCounts[top.id] || top.baseViewers || 0) + ' watching';
}

function renderTrending() {
  const sorted = S.channels.slice().sort((a,b) =>
    (S.viewerCounts[b.id] || b.baseViewers || 0) - (S.viewerCounts[a.id] || a.baseViewers || 0)
  ).slice(0,8);
  el('trending-grid').innerHTML = sorted.map(buildCard).join('');
}

function renderRecentRow() {
  const row = el('recent-row');
  const sec = el('sec-recent');
  if (!S.recent.length) {
    sec.style.display = 'none'; return;
  }
  sec.style.display = '';
  const chs = S.recent.map(id => S.channels.find(c => c.id === id)).filter(Boolean);
  if (!chs.length) { sec.style.display = 'none'; return; }
  row.innerHTML = chs.map((ch, i) => {
    const logo = ch.logo || ch.emoji || '📺';
    return `
      <div class="rw-card" onclick="APP.openChannel('${esc(ch.id)}')">
        <div class="rw-thumb">
          ${logo.startsWith('http')
            ? `<img src="${esc(logo)}" onerror="this.style.display='none'">`
            : `<span>${esc(logo)}</span>`}
          <div class="ch-live-badge" style="position:absolute;top:6px;left:6px"><div class="dot" style="width:4px;height:4px;border-radius:50%;background:#fff;display:inline-block"></div> LIVE</div>
        </div>
        <div class="rw-prog-bar"><div class="rw-prog-fill" style="width:${15+i*8}%"></div></div>
        <div class="rw-info">
          <div class="rw-name">${esc(ch.name)}</div>
          <div class="rw-sub">${esc((ch.group||'LIVE').toUpperCase())} · ${esc(ch.quality||'HD')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLivePage() {
  const hasChs = S.channels.length > 0;
  el('no-playlist-msg').style.display = hasChs ? 'none' : '';
  el('live-main').style.display       = hasChs ? 'block' : 'none';

  if (!hasChs) return;

  el('live-ch-count').textContent = `${S.totalChs || S.channels.length} CHANNELS`;

  // Category filter pills
  renderCatPills();

  // Channel grid
  el('live-grid').innerHTML = S.channels.map(buildCard).join('');

  // Load more
  const showMore = S.channels.length < S.totalChs;
  el('load-more-wrap').style.display = showMore ? 'block' : 'none';
}

function renderCatPills() {
  const row = el('live-cat-row');
  const cats = [{ name:'all', count: S.totalChs }, ...S.categories.slice(0,20)];
  row.innerHTML = cats.map(c => `
    <div class="cat-pill ${S.filterCat === c.name ? 'active' : ''}"
         onclick="APP.filterByCategory('${esc(c.name)}')">
      ${getCatIcon(c.name)} ${c.name === 'all' ? 'ALL' : esc(c.name.toUpperCase())}
      <span class="cnt">${c.count || ''}</span>
    </div>
  `).join('');
}

function renderCategoryPage() {
  const grid  = el('cat-grid');
  const count = el('cat-count');
  if (!S.categories.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-ico">◈</div><div class="empty-title">NO CATEGORIES</div><div class="empty-sub">LOAD A PLAYLIST TO SEE CATEGORIES</div></div>`;
    return;
  }
  count.textContent = S.categories.length + ' CATEGORIES';
  grid.innerHTML = S.categories.map(c => `
    <div class="cat-card" onclick="APP.openCategory('${esc(c.name)}')">
      <span class="cat-card-ico">${getCatIcon(c.name)}</span>
      <div class="cat-card-name">${esc(c.name)}</div>
      <div class="cat-card-cnt">${c.count} CHANNELS</div>
    </div>
  `).join('');
}

function renderFavoritesPage() {
  const cont = el('fav-content');
  const favChs = S.channels.filter(c => S.favorites.includes(c.id));

  if (!favChs.length) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-ico">★</div>
      <div class="empty-title">NO FAVORITES YET</div>
      <div class="empty-sub">HOVER A CHANNEL CARD AND PRESS ★ TO SAVE IT HERE</div>
    </div>`;
    return;
  }
  cont.innerHTML = `<div class="ch-grid">${favChs.map(buildCard).join('')}</div>`;
}

function renderPlTabs() {
  const tabs = el('pl-tabs');
  if (!S.playlists.length) {
    tabs.innerHTML = `<span style="font-family:'Share Tech Mono',monospace;font-size:0.6rem;color:var(--text-3);letter-spacing:1px">No playlists loaded</span>`;
    return;
  }
  tabs.innerHTML = S.playlists.map(pl => `
    <div class="pl-tab ${pl.id === S.activePl ? 'active' : ''}" onclick="APP.activatePlaylist('${esc(pl.id)}')">
      ${esc(pl.name)} <span class="pl-cnt">${pl.count}</span>
      <span class="pl-del" onclick="event.stopPropagation();APP.deletePlaylist('${esc(pl.id)}')" title="Remove">✕</span>
    </div>
  `).join('');
}

function renderEPG(epg) {
  if (!epg || !epg.length) return;
  const slots = ['18:00','19:00','20:00','21:00','22:00','23:00'];
  let html = `<div class="epg-header">${slots.map(s=>`<div class="epg-slot">${s}</div>`).join('')}</div>`;
  epg.slice(0,16).forEach(row => {
    html += `<div class="epg-row">
      <div class="epg-ch-col">
        <div class="epg-ch-name">${esc(row.channelName)}</div>
        <div class="epg-ch-group">${esc((row.genre||'LIVE').toUpperCase())}</div>
      </div>
      <div class="epg-progs">
        ${row.programs.map(p => `
          <div class="epg-prog ${p.isNow?'now':''}" style="--flex:${p.duration/60}">
            <div class="epg-prog-name">${esc(p.title)}</div>
            <div class="epg-prog-time">${p.start} · ${p.duration}m</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  });
  el('epg-table').innerHTML = html;
}

// ── CHANNEL CARD BUILDER ─────────────────────────────────
function buildCard(ch) {
  const isFav     = S.favorites.includes(ch.id);
  const viewers   = S.viewerCounts[ch.id] || ch.baseViewers || 0;
  const logo      = ch.logo || ch.emoji || '📺';
  const logoHtml  = logo.startsWith('http')
    ? `<img class="ch-thumb-logo" src="${esc(logo)}" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\\'ch-thumb-fallback\\'>${getCatIcon(ch.group||'')}</span>'+this.parentNode.innerHTML.replace(/<img[^>]*>/,'');">`
    : `<span class="ch-thumb-fallback">${esc(logo)}</span>`;

  return `
    <div class="ch-card ${isFav?'in-wl':''}" data-id="${esc(ch.id)}" onclick="APP.openChannel('${esc(ch.id)}')">
      <div class="ch-thumb">
        ${logoHtml}
        <div class="ch-live-badge"><div class="dot" style="width:4px;height:4px;border-radius:50%;background:#fff;display:inline-block;margin-right:2px"></div>LIVE</div>
        ${ch.quality ? `<div class="ch-qual-badge">${esc(ch.quality)}</div>` : ''}
        <div class="ch-overlay">
          <button class="ch-play-btn" onclick="event.stopPropagation();APP.openChannel('${esc(ch.id)}')">
            <svg viewBox="0 0 12 14" fill="none"><path d="M1 1l10 6L1 13V1z" fill="#050a14"/></svg>
          </button>
          <button class="ch-fav-btn ${isFav?'on':''}" data-id="${esc(ch.id)}" title="${isFav?'Remove from favorites':'Add to favorites'}" onclick="event.stopPropagation();APP.toggleFav('${esc(ch.id)}')">★</button>
        </div>
      </div>
      <div class="ch-info">
        <div class="ch-name">${esc(ch.name)}</div>
        <div class="ch-prog">${esc(ch.prog || ch.tvgName || '')}</div>
        <div class="ch-foot">
          <div class="ch-cat-tag">${esc((ch.group||'live').toUpperCase())}</div>
          <div class="ch-viewers"><span class="ch-viewers-dot">●</span> ${fmtN(viewers)}</div>
        </div>
      </div>
    </div>
  `;
}

function updateViewerDisplays() {
  document.querySelectorAll('.ch-viewers').forEach(el => {
    const card = el.closest('[data-id]');
    if (!card) return;
    const id = card.getAttribute('data-id');
    if (id && S.viewerCounts[id]) {
      el.innerHTML = `<span class="ch-viewers-dot">●</span> ${fmtN(S.viewerCounts[id])}`;
    }
  });
}

// ═══════════════════════════════════════════════════════
//  CHANNEL OPEN / HLS PLAYER
// ═══════════════════════════════════════════════════════
async function openChannel(id) {
  const ch = S.channels.find(c => c.id === id);
  if (!ch) return;

  S.currentCh   = ch;
  S.usingProxy  = false;

  // Track recent
  S.recent = [id, ...S.recent.filter(r => r !== id)].slice(0,15);
  localStorage.setItem('vhv3_recent', JSON.stringify(S.recent));
  renderRecentRow();

  // Join socket room
  if (S.socket) S.socket.emit('join_channel', id);

  // Fill player UI
  fillPlayerUI(ch);

  // Show modal
  el('player-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
  showPlayerLoading('CONNECTING TO STREAM...');

  // Load stream
  await startStream(ch.url, ch);

  // Load ratings
  loadRatings(id);

  sfx();
}

function fillPlayerUI(ch) {
  const logo = ch.logo || ch.emoji || '📺';
  if (logo.startsWith('http')) {
    el('pm-ch-logo').innerHTML = `<img src="${esc(logo)}" style="width:100%;height:100%;object-fit:contain;border-radius:5px" onerror="this.parentNode.textContent='📺'">`;
  } else {
    el('pm-ch-logo').textContent = logo;
  }
  el('pm-ch-name').textContent  = ch.name;
  el('pm-ch-prog').textContent  = ch.prog || ch.group || 'LIVE';
  el('pm-title').textContent    = ch.name;
  el('pm-meta-cat').textContent = (ch.group || 'LIVE').toUpperCase();
  el('pm-meta-qual').innerHTML  = `<em>${ch.quality || 'HD'}</em>`;
  el('pm-meta-country').textContent = ch.country || ch.language || '🌍';
  el('pm-desc').textContent     = `Now airing: ${ch.prog || ch.name} · ${ch.time || 'LIVE'}`;
  el('pm-viewer-cnt').textContent = fmtN(S.viewerCounts[ch.id] || 0);
  el('chat-cnt').textContent    = fmtN(S.viewerCounts[ch.id] || 0) + ' viewers';

  // Fav button state
  el('pm-fav').classList.toggle('on', S.favorites.includes(ch.id));
  el('pm-fav').textContent = S.favorites.includes(ch.id) ? '★ FAVORITED' : '★ FAVORITE';

  // Mini player
  el('mini-logo').textContent = logo.startsWith('http') ? '📺' : logo;
  el('mini-name').textContent = ch.name;
  el('mini-prog').textContent = ch.group || 'LIVE';
}

async function startStream(url, ch) {
  if (!url) {
    showPlayerError('NO STREAM URL', 'This channel has no stream URL configured.');
    return;
  }

  showPlayerLoading('INITIALIZING STREAM...');
  hidePlayerError();

  // Destroy any previous instances
  if (S.hlsInstance)  { S.hlsInstance.destroy();  S.hlsInstance  = null; }
  if (S.dashInstance) { S.dashInstance.destroy(); S.dashInstance = null; }
  if (S.flvInstance)  { S.flvInstance.destroy();  S.flvInstance  = null; }

  const video = el('hls-video');
  video.pause();
  video.removeAttribute('src');
  video.load();

  const streamUrl = (S.fx.proxy && url.startsWith('http'))
    ? `/api/proxy/stream?url=${encodeURIComponent(url)}`
    : url;

  // Detect format from URL (strip query params for matching)
  const urlBase = url.split('?')[0].toLowerCase();
  const isHLS  = urlBase.includes('.m3u8') || urlBase.includes('m3u8');
  const isDASH = urlBase.includes('.mpd');
  const isFLV  = urlBase.includes('.flv');
  const isTS   = /\.(ts|mts|m2ts)(\?|$)/.test(urlBase);
  // Formats natively supported by most browsers
  const isNative = /\.(mp4|webm|ogg|ogv|mov|3gp|3g2|mp3|aac|flac|wav|opus)(\?|$)/.test(urlBase);
  // If no extension at all, assume HLS (common for live streams)
  const hasNoExt = !/\.[a-z0-9]{2,5}(\?|$)/.test(urlBase);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function onPlaySuccess() {
    hidePlayerLoading();
    S.isPlaying = true;
    el('pm-pp-btn').textContent = '⏸ PAUSE';
    animateSeekbar();
    toast(`📺 ${ch.name}`, 'info', 2500);
  }

  function onFatalError(code, detail) {
    if (!S.usingProxy && S.fx.proxy) {
      S.usingProxy = true;
      startStream(url, ch);
    } else {
      showPlayerError(code, detail);
    }
  }

  // ── HLS ────────────────────────────────────────────────────────────────────
  if ((isHLS || isTS || hasNoExt) && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
    S.hlsInstance = hls;
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      onPlaySuccess();
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) { hls.destroy(); S.hlsInstance = null; onFatalError('HLS ERROR', `${data.type}: ${data.details}`); }
    });

  // ── Native HLS (Safari) ────────────────────────────────────────────────────
  } else if ((isHLS || isTS || hasNoExt) && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); onPlaySuccess(); }, { once: true });
    video.addEventListener('error', () => onFatalError('HLS ERROR', 'Could not load HLS stream'), { once: true });

  // ── MPEG-DASH ──────────────────────────────────────────────────────────────
  } else if (isDASH && typeof dashjs !== 'undefined') {
    const dash = dashjs.MediaPlayer().create();
    dash.initialize(video, streamUrl, true);
    dash.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, onPlaySuccess);
    dash.on(dashjs.MediaPlayer.events.ERROR, (e) => onFatalError('DASH ERROR', e.error?.message || 'DASH stream error'));
    S.dashInstance = dash;

  // ── FLV / HTTP-FLV ────────────────────────────────────────────────────────
  } else if (isFLV && typeof flvjs !== 'undefined' && flvjs.isSupported()) {
    const flv = flvjs.createPlayer({ type: 'flv', url: streamUrl });
    flv.attachMediaElement(video);
    flv.load();
    flv.play();
    flv.on(flvjs.Events.MEDIA_INFO, onPlaySuccess);
    flv.on(flvjs.Events.ERROR, (_, detail) => { flv.destroy(); S.flvInstance = null; onFatalError('FLV ERROR', detail); });
    S.flvInstance = flv;

  // ── Native / Direct (mp4, webm, mov, etc.) — with HLS.js probe fallback ──
  } else {
    video.src = streamUrl;
    video.load();
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {});
      onPlaySuccess();
    }, { once: true });
    video.addEventListener('error', () => {
      const code = video.error?.code;
      // Code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED — try HLS.js as a last resort
      // (catches avi, mkv, wmv and any live stream with a misleading extension)
      if (code === 4 && Hls.isSupported()) {
        video.removeAttribute('src');
        video.load();
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
        S.hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); onPlaySuccess(); });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) { hls.destroy(); S.hlsInstance = null; onFatalError('PLAYBACK ERROR', 'Format not supported by this browser'); }
        });
      } else {
        const errMap = { 1: 'Aborted', 2: 'Network error', 3: 'Decode error', 4: 'Format not supported' };
        onFatalError('PLAYBACK ERROR', errMap[code] || 'Unknown error');
      }
    }, { once: true });
  }
}

function showPlayerLoading(txt = 'LOADING...') {
  el('pm-loading').classList.remove('hidden');
  el('pm-loading-txt').textContent = txt;
  el('pm-center').classList.add('hidden');
  hidePlayerError();
}
function hidePlayerLoading() {
  el('pm-loading').classList.add('hidden');
  el('pm-center').classList.remove('hidden');
}
function showPlayerError(code, msg) {
  hidePlayerLoading();
  el('pm-err').classList.add('show');
  el('pm-err-msg').textContent = msg || '';
  el('pm-err').querySelector('.pm-err-code').textContent = code || 'ERROR';
}
function hidePlayerError() { el('pm-err').classList.remove('show'); }

function retryStream() {
  if (S.currentCh) startStream(S.currentCh.url, S.currentCh);
}
async function tryProxy() {
  if (!S.currentCh) return;
  S.usingProxy = true;
  S.fx.proxy   = true;
  await startStream(S.currentCh.url, S.currentCh);
  toast('Retrying with server proxy...', 'info');
}

function closePlayer() {
  el('player-modal').classList.remove('show');
  document.body.style.overflow = '';
  const video = el('hls-video');
  video.pause();
  if (S.hlsInstance)  { S.hlsInstance.destroy();  S.hlsInstance  = null; }
  if (S.dashInstance) { S.dashInstance.destroy(); S.dashInstance = null; }
  if (S.flvInstance)  { S.flvInstance.destroy();  S.flvInstance  = null; }
  video.removeAttribute('src');
  video.load();
  S.isPlaying = false;
}

function miniMode() {
  closePlayer();
  el('mini-player').classList.add('show');
}
function closeMini() { el('mini-player').classList.remove('show'); }
function reopenPlayer() {
  el('mini-player').classList.remove('show');
  if (S.currentCh) openChannel(S.currentCh.id);
}

// ── PLAYBACK CONTROLS ────────────────────────────────────
function togglePlay() {
  const v = el('hls-video');
  if (v.paused) { v.play(); S.isPlaying = true; el('pm-pp-btn').textContent = '⏸ PAUSE'; }
  else          { v.pause(); S.isPlaying = false; el('pm-pp-btn').textContent = '▶ PLAY'; }
}
function toggleMute() {
  S.isMuted = !S.isMuted;
  el('hls-video').muted = S.isMuted;
  el('pm-mute').textContent = S.isMuted ? '🔇' : '🔊';
}
function toggleFullscreen() {
  const s = el('player-modal');
  if (!document.fullscreenElement) s.requestFullscreen?.();
  else document.exitFullscreen?.();
}
async function togglePiP() {
  const v = el('hls-video');
  if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(()=>{});
  else if (v.readyState) await v.requestPictureInPicture().catch(()=>{});
}
function switchQual(q) { toast(`Quality: ${q} (simulated)`, 'info', 1800); }

let seekTimer;
function animateSeekbar() {
  clearInterval(seekTimer);
  let pct = 35;
  seekTimer = setInterval(() => {
    if (!S.isPlaying) return;
    pct = Math.min(98.5, pct + 0.04);
    el('pm-seek-fill').style.width = pct + '%';
  }, 600);
}

// ── RATINGS ──────────────────────────────────────────────
async function loadRatings(id) {
  try {
    const d = await api(`/api/ratings/${id}`);
    setRatingUI(d.up, d.down);
  } catch(e) {
    setRatingUI(Math.floor(Math.random()*500)+50, Math.floor(Math.random()*20));
  }
}
function setRatingUI(up, down) {
  el('pm-up-n').textContent = fmtN(up);
  el('pm-dn-n').textContent = fmtN(down);
}
async function rate(vote) {
  if (!S.currentCh) return;
  try {
    const d = await api(`/api/ratings/${S.currentCh.id}`, 'POST', { vote });
    setRatingUI(d.up, d.down);
    el(vote==='up'?'pm-up':'pm-down').classList.add('voted');
    toast(vote==='up'?'👍 Liked!':'👎 Disliked', 'info', 1500);
  } catch(e) {}
}

// ── FAVORITES ────────────────────────────────────────────
function toggleFav(id) {
  if (S.socket) {
    S.socket.emit('toggle_watchlist', id);
  } else {
    // Local-only fallback
    const idx = S.favorites.indexOf(id);
    if (idx >= 0) { S.favorites.splice(idx,1); toast('☆ Removed', 'info'); }
    else          { S.favorites.push(id);      toast('★ Favorited', 'success'); }
    saveFavs();
    renderFavBadge();
    if (S.currentPage === 'favorites') renderFavoritesPage();
  }
  sfx();
}
function toggleFavFromPlayer() { if (S.currentCh) toggleFav(S.currentCh.id); }
function saveFavs() { localStorage.setItem('vhv3_favs', JSON.stringify(S.favorites)); }
function renderFavBadge() {
  const n = S.favorites.length;
  el('badge-fav').textContent = n;
  el('badge-fav').style.display = n > 0 ? '' : 'none';
}
function updateBadges() {
  renderFavBadge();
  el('badge-live').textContent = S.totalChs || S.channels.length || '—';
}
function clearFavorites() {
  S.favorites = [];
  saveFavs();
  renderFavBadge();
  renderFavoritesPage();
  if (S.socket) S.socket.emit('toggle_watchlist', '__clear__');
  toast('Favorites cleared', 'info');
}

// ── CHAT ─────────────────────────────────────────────────
function sendChat() {
  const inp = el('chat-inp');
  const msg = inp.value.trim();
  if (!msg || !S.currentCh) return;
  if (S.socket) {
    S.socket.emit('chat_message', { channelId: S.currentCh.id, message: msg });
  } else {
    renderChatMsg({ user: S.username || 'You', avatar: S.avatar, message: msg, ts: new Date().toISOString() });
  }
  inp.value = '';
}
function renderChatMsg(msg) {
  const box = el('chat-msgs');
  const d   = document.createElement('div');
  d.className = 'chat-msg';
  d.innerHTML = `
    <div class="chat-avatar">${esc(msg.avatar||'🎭')}</div>
    <div><div class="chat-user">${esc(msg.user)}</div><div class="chat-text">${esc(msg.message)}</div></div>
  `;
  box.appendChild(d);
}

// ── SEARCH ───────────────────────────────────────────────
async function handleSearch(e) {
  const q = e.target ? e.target.value.trim() : '';
  const dd = el('search-dd');
  const x  = el('search-x');
  x.style.display = q ? 'block' : 'none';

  if (!q || q.length < 1) { dd.classList.remove('show'); return; }

  try {
    const data = await api(`/api/channels/search?q=${encodeURIComponent(q)}`);
    const results = data.results || [];
    if (!results.length) {
      dd.innerHTML = `<div class="sd-empty">NO RESULTS FOR "${esc(q.toUpperCase())}"</div>`;
    } else {
      dd.innerHTML = results.slice(0,10).map(ch => {
        const logo = ch.logo || ch.emoji || '📺';
        return `
          <div class="sd-item" onclick="APP.openChannel('${esc(ch.id)}');APP.clearSearch()">
            <div class="sd-logo">${logo.startsWith('http') ? `<img src="${esc(logo)}" style="width:100%;height:100%;object-fit:contain;border-radius:3px" onerror="this.textContent='📺'">` : esc(logo)}</div>
            <div class="sd-info">
              <div class="sd-name">${esc(ch.name)}</div>
              <div class="sd-group">${esc(ch.group||'LIVE')}</div>
            </div>
          </div>
        `;
      }).join('');
    }
    dd.classList.add('show');
  } catch(e) {
    // Fallback: local search
    const q2 = q.toLowerCase();
    const res = S.channels.filter(c =>
      c.name.toLowerCase().includes(q2) || (c.group||'').toLowerCase().includes(q2)
    ).slice(0,10);
    dd.innerHTML = res.length
      ? res.map(ch => `<div class="sd-item" onclick="APP.openChannel('${esc(ch.id)}');APP.clearSearch()"><div class="sd-logo">${esc(ch.emoji||ch.logo||'📺')}</div><div class="sd-info"><div class="sd-name">${esc(ch.name)}</div><div class="sd-group">${esc(ch.group||'LIVE')}</div></div></div>`).join('')
      : `<div class="sd-empty">NO RESULTS</div>`;
    dd.classList.add('show');
  }
}

function clearSearch() {
  el('search-inp').value = '';
  el('search-x').style.display = 'none';
  el('search-dd').classList.remove('show');
}

// ── FILTERING ─────────────────────────────────────────────
async function filterByCategory(cat) {
  S.filterCat = cat;
  S.channelPage = 1;
  await loadChannels(true);
  sfx();
}

function openCategory(name) {
  nav('live');
  filterByCategory(name);
}

async function loadMoreChannels() {
  S.channelPage++;
  await loadChannels(false);
}

function clearRecent() {
  S.recent = [];
  localStorage.removeItem('vhv3_recent');
  renderRecentRow();
  toast('History cleared', 'info');
}

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
const CRUMBS = { home:'HOME', live:'LIVE TV', categories:'CATEGORIES', favorites:'FAVORITES', epg:'SCHEDULE', settings:'SETTINGS' };

function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  const pg = el('page-' + page);
  if (pg) pg.classList.add('active');
  const si = document.querySelector(`.sb-item[data-page="${page}"]`);
  if (si) si.classList.add('active');

  // Sync bottom nav active state
  document.querySelectorAll('.bnav-item').forEach(i => i.classList.remove('active'));
  const bi = document.querySelector(`.bnav-item[data-bnav="${page}"]`);
  if (bi) bi.classList.add('active');

  el('crumb').innerHTML = `SYS / <em>${CRUMBS[page] || page.toUpperCase()}</em>`;
  S.currentPage = page;

  // Lazy renders
  if (page === 'home')       renderHomePage();
  if (page === 'live')       renderLivePage();
  if (page === 'categories') renderCategoryPage();
  if (page === 'favorites')  renderFavoritesPage();
  if (page === 'epg')        loadEPG();

  // Mobile: close sidebar
  el('sidebar').classList.remove('mobile-open');
  sfx();
}

// ── SIDEBAR ──────────────────────────────────────────────
let sbCollapsed = false;
function toggleSidebar() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    el('sidebar').classList.toggle('mobile-open');
  } else {
    sbCollapsed = !sbCollapsed;
    el('sidebar').classList.toggle('collapsed', sbCollapsed);
    document.body.classList.toggle('sb-collapsed', sbCollapsed);
    el('sb-toggle').textContent = sbCollapsed ? '▶' : '◀';
  }
}

// ── PLAYLIST MODAL ───────────────────────────────────────
function openPlModal() {
  el('pl-modal').classList.add('show');
  el('pl-status').textContent = '';
}
function closePlModal() {
  el('pl-modal').classList.remove('show');
  fileContent = null;
}
function plModalTab(mode, btn) {
  plModalMode = mode;
  document.querySelectorAll('.pl-modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pl-modal-tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  el('pl-tab-' + mode).classList.add('active');
  el('pl-status').textContent = '';
}

// ── SETTINGS ─────────────────────────────────────────────
function setSettingsTab(btn) {
  document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
  btn.classList.add('active');
}
function toggleFx(key, btn) {
  btn.classList.toggle('on');
  S.fx[key] = btn.classList.contains('on');
  if (key === 'particles') { /* handled by animate loop */ }
  if (key === 'scanlines') el('scanlines').style.display = S.fx.scanlines ? '' : 'none';
  localStorage.setItem('vhv3_fx', JSON.stringify(S.fx));
}
function loadFxPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('vhv3_fx') || '{}');
    Object.assign(S.fx, saved);
    if (!S.fx.scanlines) el('scanlines').style.display = 'none';
    if (!S.fx.particles) document.getElementById('t-particles')?.classList.remove('on');
    ['particles','scanlines','sfx','proxy','autoplay'].forEach(k => {
      const t = el('t-' + k); if (t) t.classList.toggle('on', S.fx[k]);
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════
function startParticles() {
  const cvs = document.getElementById('bg-canvas');
  const ctx  = cvs.getContext('2d');
  let W, H, pts = [];

  const resize = () => { W = cvs.width = innerWidth; H = cvs.height = innerHeight; };
  resize(); addEventListener('resize', resize);

  class Pt {
    constructor() { this.r(); }
    r() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.sz = Math.random() * 1.4 + 0.2;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.op = Math.random() * 0.45 + 0.08;
      this.h  = Math.random() > 0.65 ? 280 : 195;
    }
    step() {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.r();
    }
    draw() {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.sz, 0, Math.PI*2);
      ctx.fillStyle = `hsla(${this.h},100%,70%,${this.op})`; ctx.fill();
    }
  }

  for (let i = 0; i < 100; i++) pts.push(new Pt());

  const links = () => {
    for (let i = 0; i < pts.length; i++)
      for (let j = i+1; j < pts.length; j++) {
        const dx = pts[i].x-pts[j].x, dy = pts[i].y-pts[j].y;
        const d  = Math.sqrt(dx*dx+dy*dy);
        if (d < 90) {
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = `rgba(0,212,255,${0.035*(1-d/90)})`; ctx.lineWidth = 0.5; ctx.stroke();
        }
      }
  };

  const loop = () => {
    requestAnimationFrame(loop);
    if (!S.fx.particles) return;
    ctx.clearRect(0,0,W,H);
    links();
    pts.forEach(p => { p.step(); p.draw(); });
  };
  loop();
}

// ═══════════════════════════════════════════════════════
//  EPG CLOCK
// ═══════════════════════════════════════════════════════
function startEPGClock() {
  const tick = () => {
    const n = new Date();
    const t = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
    el('epg-clock').textContent = t;
  };
  tick(); setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
function toast(msg, type='info', dur=3200) {
  const icons = { success:'✅', warn:'⚠️', info:'ℹ️', err:'❌' };
  const stack = el('toasts');
  const t     = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${esc(msg)}</span><span class="toast-x" onclick="this.parentElement.remove()">✕</span>`;
  stack.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 280); }, dur);
}

// ═══════════════════════════════════════════════════════
//  SFX
// ═══════════════════════════════════════════════════════
let _actx;
function sfx() {
  if (!S.fx.sfx) return;
  try {
    if (!_actx) _actx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = _actx.createOscillator(), g = _actx.createGain();
    osc.connect(g); g.connect(_actx.destination);
    osc.frequency.setValueAtTime(880, _actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, _actx.currentTime + 0.1);
    g.gain.setValueAtTime(0.08, _actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _actx.currentTime + 0.15);
    osc.start(); osc.stop(_actx.currentTime + 0.15);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════
//  API HELPER
// ═══════════════════════════════════════════════════════
async function api(url, method='GET', body=null) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'X-Socket-Id':   S.socketId || 'anon',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
const el  = id => document.getElementById(id);
const esc = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const pad = n  => String(n).padStart(2,'0');

function fmtN(n) {
  n = Number(n)||0;
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(1)+'K';
  return String(n);
}

function debounce(fn, ms) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function getCatIcon(cat) {
  const c = (cat||'').toLowerCase();
  if (/sport|foot|soccer|basket|tennis|golf|rugby/.test(c)) return '⚽';
  if (/news|info/.test(c)) return '📡';
  if (/movie|film|cinema|cine/.test(c)) return '🎬';
  if (/music|mtv|trace/.test(c)) return '🎵';
  if (/kids|child|junior|cartoon|nickel|disney/.test(c)) return '🧸';
  if (/doc|discovery|national|nat geo/.test(c)) return '🔬';
  if (/nature|wild|animal/.test(c)) return '🌿';
  if (/game|gaming/.test(c)) return '🎮';
  if (/anime|manga/.test(c)) return '⚔️';
  if (/entertain|general/.test(c)) return '🎭';
  return '📺';
}

function buildLocalCategories(channels) {
  const map = {};
  channels.forEach(c => { const g = c.group||c.genre||'Other'; map[g] = (map[g]||0)+1; });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
}

function randomAvatar() {
  return ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆'][Math.floor(Math.random()*14)];
}

function showPageLoader() {
  el('pg-bar').style.opacity = '1';
  el('pg-bar').style.width   = '70%';
}

// ═══════════════════════════════════════════════════════
//  DEMO CHANNELS (fallback when no server or no playlist)
// ═══════════════════════════════════════════════════════
const DEMO_CHANNELS = [
  {id:'d1',name:'beIN SPORTS 1',group:'Sport',emoji:'⚽',baseViewers:32000,prog:'Champions League',time:'21:00',quality:'HD',country:'QA',url:''},
  {id:'d2',name:'ESPN HD',group:'Sport',emoji:'🏀',baseViewers:18000,prog:'NBA Playoffs',time:'20:00',quality:'HD',country:'US',url:''},
  {id:'d3',name:'Sky Sports',group:'Sport',emoji:'🏏',baseViewers:14000,prog:'Ashes Test',time:'10:00',quality:'4K',country:'GB',url:''},
  {id:'d4',name:'France 24',group:'News',emoji:'📡',baseViewers:5600,prog:'World News',time:'20:00',quality:'HD',country:'FR',url:''},
  {id:'d5',name:'BBC World News',group:'News',emoji:'🌐',baseViewers:8000,prog:'Global Report',time:'21:00',quality:'HD',country:'GB',url:''},
  {id:'d6',name:'CNN International',group:'News',emoji:'🗞',baseViewers:11000,prog:'Breaking News',time:'19:00',quality:'HD',country:'US',url:''},
  {id:'d7',name:'Canal+ Cinéma',group:'Movies',emoji:'🎬',baseViewers:7800,prog:'Dune: Part Two',time:'21:00',quality:'4K',country:'FR',url:''},
  {id:'d8',name:'HBO Max',group:'Movies',emoji:'🍿',baseViewers:22000,prog:'House of the Dragon',time:'22:00',quality:'4K',country:'US',url:''},
  {id:'d9',name:'Nickelodeon',group:'Kids',emoji:'🧸',baseViewers:4100,prog:'SpongeBob',time:'18:00',quality:'HD',country:'US',url:''},
  {id:'d10',name:'Cartoon Network',group:'Kids',emoji:'🎨',baseViewers:3800,prog:'Ben 10',time:'17:00',quality:'HD',country:'US',url:''},
  {id:'d11',name:'MTV HD',group:'Music',emoji:'🎵',baseViewers:9000,prog:'Top 100',time:'19:00',quality:'HD',country:'US',url:''},
  {id:'d12',name:'NatGeo Wild',group:'Nature',emoji:'🌿',baseViewers:3100,prog:'Planet Earth IV',time:'20:30',quality:'4K',country:'US',url:''},
  {id:'d13',name:'Discovery+',group:'Documentary',emoji:'🔬',baseViewers:2300,prog:'Space Frontier',time:'22:00',quality:'4K',country:'US',url:''},
  {id:'d14',name:'Eurosport 1',group:'Sport',emoji:'🚴',baseViewers:6200,prog:'Tour de France',time:'14:00',quality:'HD',country:'EU',url:''},
  {id:'d15',name:'Trace Africa',group:'Music',emoji:'🥁',baseViewers:3600,prog:'Afrobeats Top 50',time:'19:00',quality:'HD',country:'CM',url:''},
  {id:'d16',name:'Al Jazeera',group:'News',emoji:'📺',baseViewers:7000,prog:'Inside Story',time:'22:00',quality:'HD',country:'QA',url:''},
];

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', init);

// ── EXPORT PUBLIC METHODS ───────────────────────────────
return {
  nav, toggleSidebar,
  openChannel, closePlayer, retryStream, tryProxy,
  togglePlay, toggleMute, toggleFullscreen, togglePiP,
  miniMode, closeMini, reopenPlayer,
  switchQual, rate, toggleFav, toggleFavFromPlayer,
  sendChat,
  filterByCategory, openCategory, loadMoreChannels,
  clearRecent, clearFavorites,
  openPlModal, closePlModal, plModalTab, submitPlaylist,
  handleFileInput, handleDrop,
  activatePlaylist, deletePlaylist, loadUrlFromSettings,
  setSettingsTab, toggleFx,
  clearSearch,
};

})(); // APP IIFE
