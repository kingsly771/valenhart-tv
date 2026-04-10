/**
 * VALENHART TV v6.0 — Full IPTV Feature Suite
 * By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗
 *
 * NEW FEATURES:
 *  - VOD / Movies library with search & genres
 *  - Multi-screen (up to 4 simultaneous streams)
 *  - Sleep timer (15/30/60/90/120min auto-stop)
 *  - Parental controls with PIN lock
 *  - Stream health / buffer stats overlay
 *  - Subtitle & audio track selector
 *  - Keyboard shortcuts panel
 *  - Channel bookmarks / notes
 *  - Import & export favorites (JSON/M3U)
 *  - Playlist editor (rename, reorder, group)
 *  - Dark / light theme toggle
 *  - Chromecast / AirPlay detect & prompt
 *  - Stream statistics HUD
 *  - Catchup TV / time-shift stubs
 *  - Channel groups / bouquets
 *  - Autoplay next channel in category
 */

const APP = (() => {
'use strict';

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
const S = {
  // Core
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

  // Persistence
  favorites: JSON.parse(localStorage.getItem('vhv6_favs')   || '[]'),
  recent:    JSON.parse(localStorage.getItem('vhv6_recent') || '[]'),
  bookmarks: JSON.parse(localStorage.getItem('vhv6_bookmarks') || '{}'), // {channelId: note}
  bouquets:  JSON.parse(localStorage.getItem('vhv6_bouquets')  || '[]'), // [{id,name,channels:[]}]

  // Socket
  socket:   null,
  socketId: null,
  username: '',
  avatar:   '🎭',

  // Players
  hlsInstance:  null,
  dashInstance: null,
  flvInstance:  null,
  multiScreens: [],   // up to 4 HLS instances
  isPlaying:    false,
  isMuted:      false,
  usingProxy:   false,
  currentVolume: 1.0,
  currentSubTrack: -1,
  currentAudioTrack: 0,
  streamStats:  { bitrate: 0, dropped: 0, buffered: 0, level: 0 },

  // Features
  sleepTimer:     null,
  sleepMinutes:   0,
  sleepRemaining: 0,
  pinLocked:      false,
  pinCode:        localStorage.getItem('vhv6_pin') || '',
  pinnedCategories: JSON.parse(localStorage.getItem('vhv6_pinned_cats') || '[]'),
  theme:          localStorage.getItem('vhv6_theme') || 'dark',
  vodItems:       [],
  vodPage:        1,
  vodFilter:      'all',
  multiMode:      false,
  catchupDate:    null,

  // VOD (loaded from playlist groups tagged as VOD/Movie/Series)
  vodChannels:    [],

  fx: {
    particles: true,
    scanlines: true,
    sfx:       false,
    proxy:     true,
    autoplay:  true,
    autoNext:  false,   // autoplay next channel in category
    statsHud:  false,   // stream stats overlay
    subtitles: true,
  },
};

// ═══════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════
function applyTheme(theme) {
  S.theme = theme;
  localStorage.setItem('vhv6_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  const btn = el('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀ LIGHT' : '🌙 DARK';
}

function toggleTheme() {
  applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  toast(`Theme: ${S.theme.toUpperCase()}`, 'info', 1500);
}

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
      const vhUser = window.VH?.getUser?.();
      const displayName   = vhUser?.username || username;
      const displayAvatar = vhUser?.avatar   || S.avatar;
      el('tb-name').textContent   = displayName;
      el('sb-status').textContent = displayName;
      el('tb-avatar').textContent = displayAvatar;
      socket.emit('get_watchlist');
    });

    socket.on('online_count', n => { el('sb-status').textContent = `${n} ONLINE`; });

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
      ids.forEach(id => { if (!S.favorites.includes(id)) S.favorites.push(id); });
      saveFavs(); renderFavBadge();
    });

    socket.on('watchlist_update', ({ channelId, added }) => {
      if (added) { if (!S.favorites.includes(channelId)) S.favorites.push(channelId); }
      else { S.favorites = S.favorites.filter(f => f !== channelId); }
      saveFavs(); renderFavBadge();
      document.querySelectorAll(`.ch-fav-btn[data-id="${channelId}"]`).forEach(b => {
        b.classList.toggle('on', added);
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
  applyTheme(S.theme);
  loadFxPrefs();
  initSocket();
  startParticles();
  startEPGClock();
  initKeyboardShortcuts();
  renderSleepTimerUI();

  await Promise.all([loadPlaylists(), loadStats(), loadEPG()]);

  renderHomePage();

  // Search
  const inp = el('search-inp');
  inp.addEventListener('input', debounce(handleSearch, 220));
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) el('search-dd').classList.remove('show');
  });

  el('chat-inp').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // Mobile controls
  let controlsVisible = true, controlsTimer = null;
  function showControls() {
    controlsVisible = true;
    document.querySelector('.pm-screen')?.classList.remove('controls-hidden');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, 3500);
  }
  function hideControls() {
    controlsVisible = false;
    document.querySelector('.pm-screen')?.classList.add('controls-hidden');
  }
  document.querySelector('.pm-screen').addEventListener('click', () => {
    if (window.innerWidth <= 768) controlsVisible ? hideControls() : showControls();
  });

  // Swipe down to close
  let touchStartY = 0;
  el('player-modal').addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  el('player-modal').addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - touchStartY > 80 && window.innerWidth <= 768) closePlayer();
  }, { passive: true });

  // Volume slider
  const volSlider = el('volume-slider');
  if (volSlider) {
    volSlider.value = S.currentVolume * 100;
    volSlider.addEventListener('input', e => {
      S.currentVolume = e.target.value / 100;
      el('hls-video').volume = S.currentVolume;
      el('pm-mute').textContent = S.currentVolume === 0 ? '🔇' : '🔊';
    });
  }

  el('pg-bar').style.width = '100%';
  setTimeout(() => el('pg-bar').style.opacity = '0', 400);

  // Detect Chromecast
  detectCastDevices();
}

// ═══════════════════════════════════════════════════════
//  PARENTAL CONTROLS / PIN LOCK
// ═══════════════════════════════════════════════════════
function setPIN(pin) {
  if (!pin || pin.length < 4) return toast('PIN must be 4+ digits', 'warn');
  S.pinCode = pin;
  localStorage.setItem('vhv6_pin', pin);
  toast('PIN set successfully', 'success');
}

function lockParental() {
  if (!S.pinCode) return toast('Set a PIN first in Settings → Parental', 'warn');
  S.pinLocked = true;
  toast('🔒 Parental lock enabled', 'info');
}

function unlockParental(pin) {
  if (pin !== S.pinCode) { toast('Wrong PIN', 'err'); return false; }
  S.pinLocked = false;
  toast('🔓 Parental lock disabled', 'success');
  return true;
}

function checkParentalLock(callback) {
  if (!S.pinLocked) { callback(); return; }
  const pin = prompt('🔒 Enter PIN to continue:');
  if (pin === S.pinCode) { S.pinLocked = false; callback(); }
  else toast('Wrong PIN', 'err');
}

// ═══════════════════════════════════════════════════════
//  SLEEP TIMER
// ═══════════════════════════════════════════════════════
function setSleepTimer(minutes) {
  clearSleepTimer();
  if (!minutes) return toast('Sleep timer cleared', 'info');
  S.sleepMinutes   = minutes;
  S.sleepRemaining = minutes * 60;
  toast(`😴 Sleep timer: ${minutes} min`, 'info');

  S.sleepTimer = setInterval(() => {
    S.sleepRemaining--;
    renderSleepTimerUI();
    if (S.sleepRemaining <= 0) {
      clearSleepTimer();
      closePlayer();
      toast('😴 Sleep timer — stream stopped', 'info', 5000);
    }
  }, 1000);
}

function clearSleepTimer() {
  clearInterval(S.sleepTimer);
  S.sleepTimer     = null;
  S.sleepMinutes   = 0;
  S.sleepRemaining = 0;
  renderSleepTimerUI();
}

function renderSleepTimerUI() {
  const indicator = el('sleep-indicator');
  if (!indicator) return;
  if (S.sleepRemaining > 0) {
    const m = Math.floor(S.sleepRemaining / 60);
    const s = S.sleepRemaining % 60;
    indicator.textContent = `😴 ${m}:${pad(s)}`;
    indicator.style.display = '';
  } else {
    indicator.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════
//  STREAM STATISTICS HUD
// ═══════════════════════════════════════════════════════
let _statsInterval = null;

function startStatsHud() {
  if (!S.fx.statsHud) return;
  _statsInterval = setInterval(() => {
    const hls = S.hlsInstance;
    if (!hls) return;
    const level = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    const video = el('hls-video');
    S.streamStats = {
      bitrate:  level ? Math.round(level.bitrate / 1000) : 0,
      width:    level?.width || 0,
      height:   level?.height || 0,
      dropped:  video.webkitDroppedFrameCount || 0,
      buffered: video.buffered.length ? (video.buffered.end(0) - video.currentTime).toFixed(1) : 0,
      level:    hls.currentLevel,
      totalLevels: hls.levels?.length || 0,
    };
    renderStatsHud();
  }, 1500);
}

function stopStatsHud() {
  clearInterval(_statsInterval);
  const hud = el('stats-hud');
  if (hud) hud.style.display = 'none';
}

function renderStatsHud() {
  const hud = el('stats-hud');
  if (!hud || !S.fx.statsHud) return;
  const st = S.streamStats;
  hud.style.display = 'block';
  hud.innerHTML = `
    <div class="shud-row"><span>BITRATE</span><em>${st.bitrate || '—'} Kbps</em></div>
    <div class="shud-row"><span>RES</span><em>${st.width && st.height ? `${st.width}×${st.height}` : '—'}</em></div>
    <div class="shud-row"><span>BUFFER</span><em>${st.buffered}s</em></div>
    <div class="shud-row"><span>DROPPED</span><em>${st.dropped}</em></div>
    <div class="shud-row"><span>LEVEL</span><em>${st.level >= 0 ? `${st.level+1}/${st.totalLevels}` : 'AUTO'}</em></div>
  `;
}

function toggleStatsHud() {
  S.fx.statsHud = !S.fx.statsHud;
  if (S.fx.statsHud && S.hlsInstance) startStatsHud();
  else stopStatsHud();
  const btn = el('stats-hud-btn');
  if (btn) btn.classList.toggle('on', S.fx.statsHud);
  toast(S.fx.statsHud ? '📊 Stats overlay ON' : '📊 Stats overlay OFF', 'info', 1500);
}

// ═══════════════════════════════════════════════════════
//  SUBTITLE / AUDIO TRACKS
// ═══════════════════════════════════════════════════════
function renderTrackMenus() {
  const hls = S.hlsInstance;
  if (!hls) return;

  // Audio tracks
  const audioMenu = el('audio-track-menu');
  if (audioMenu && hls.audioTracks?.length > 1) {
    audioMenu.innerHTML = hls.audioTracks.map((t, i) => `
      <div class="track-item ${i === S.currentAudioTrack ? 'active' : ''}"
           onclick="APP.setAudioTrack(${i})">
        ${esc(t.name || t.lang || `Track ${i+1}`)}
      </div>
    `).join('');
    el('audio-track-btn')?.classList.remove('hidden');
  }

  // Subtitle tracks
  const subMenu = el('sub-track-menu');
  if (subMenu) {
    const tracks = hls.subtitleTracks || [];
    subMenu.innerHTML = `<div class="track-item ${S.currentSubTrack === -1 ? 'active' : ''}"
                              onclick="APP.setSubTrack(-1)">OFF</div>` +
      tracks.map((t, i) => `
        <div class="track-item ${i === S.currentSubTrack ? 'active' : ''}"
             onclick="APP.setSubTrack(${i})">
          ${esc(t.name || t.lang || `Sub ${i+1}`)}
        </div>
      `).join('');
    if (tracks.length) el('sub-track-btn')?.classList.remove('hidden');
  }
}

function setAudioTrack(index) {
  if (!S.hlsInstance) return;
  S.currentAudioTrack = index;
  S.hlsInstance.audioTrack = index;
  const name = S.hlsInstance.audioTracks[index]?.name || `Track ${index+1}`;
  toast(`🎵 Audio: ${name}`, 'info', 1800);
  renderTrackMenus();
}

function setSubTrack(index) {
  if (!S.hlsInstance) return;
  S.currentSubTrack = index;
  S.hlsInstance.subtitleTrack = index;
  const name = index === -1 ? 'OFF'
    : (S.hlsInstance.subtitleTracks[index]?.name || `Sub ${index+1}`);
  toast(`💬 Subtitles: ${name}`, 'info', 1800);
  renderTrackMenus();
}

function renderQualityMenu() {
  const hls = S.hlsInstance;
  const menu = el('quality-menu');
  if (!menu || !hls || !hls.levels?.length) return;

  menu.innerHTML = `<div class="track-item ${hls.currentLevel === -1 ? 'active' : ''}"
                         onclick="APP.setQualityLevel(-1)">AUTO</div>` +
    hls.levels.map((l, i) => `
      <div class="track-item ${i === hls.currentLevel ? 'active' : ''}"
           onclick="APP.setQualityLevel(${i})">
        ${l.height ? `${l.height}p` : `Level ${i+1}`}
        ${l.bitrate ? `<span style="opacity:.5;font-size:.7em">${Math.round(l.bitrate/1000)}k</span>` : ''}
      </div>
    `).join('');
}

function setQualityLevel(level) {
  if (!S.hlsInstance) return;
  S.hlsInstance.currentLevel = level;
  const label = level === -1 ? 'AUTO'
    : (S.hlsInstance.levels[level]?.height
        ? `${S.hlsInstance.levels[level].height}p`
        : `Level ${level+1}`);
  toast(`📺 Quality: ${label}`, 'info', 1500);
  renderQualityMenu();
}

// ═══════════════════════════════════════════════════════
//  CHROMECAST / AIRPLAY
// ═══════════════════════════════════════════════════════
function detectCastDevices() {
  // AirPlay — WebKit
  const video = el('hls-video');
  if (video?.webkitSupportsPresentationMode) {
    el('airplay-btn')?.classList.remove('hidden');
  }
  // Chromecast — Cast API loaded async by browser
  window['__onGCastApiAvailable'] = (isAvailable) => {
    if (isAvailable) el('cast-btn')?.classList.remove('hidden');
  };
}

function startCast() {
  const video = el('hls-video');
  if (video?.webkitSupportsPresentationMode?.('fullscreen')) {
    video.webkitSetPresentationMode('fullscreen');
  } else {
    toast('🎬 Open stream URL in Chromecast app', 'info', 4000);
    if (S.currentCh?.url) {
      navigator.clipboard?.writeText(S.currentCh.url)
        .then(() => toast('Stream URL copied to clipboard', 'success'))
        .catch(() => {});
    }
  }
}

function startAirPlay() {
  el('hls-video')?.webkitShowPlaybackTargetPicker?.();
}

// ═══════════════════════════════════════════════════════
//  MULTI-SCREEN (up to 4 simultaneous streams)
// ═══════════════════════════════════════════════════════
function openMultiScreen() {
  nav('multiscreen');
}

function renderMultiScreen() {
  const grid = el('multi-grid');
  if (!grid) return;

  const slots = [0, 1, 2, 3];
  grid.innerHTML = slots.map(i => {
    const ch = S.multiScreens[i];
    return `
      <div class="ms-slot ${ch ? 'active' : ''}" id="ms-slot-${i}">
        ${ch ? `
          <video id="ms-video-${i}" autoplay playsinline muted
                 style="width:100%;height:100%;object-fit:contain;background:#000"></video>
          <div class="ms-info">
            <span class="ms-name">${esc(ch.name)}</span>
            <button class="ms-close" onclick="APP.removeMultiScreen(${i})">✕</button>
          </div>
          <div class="ms-live-badge">⬤ LIVE</div>
        ` : `
          <div class="ms-empty" onclick="APP.pickMultiChannel(${i})">
            <div class="ms-empty-ico">＋</div>
            <div class="ms-empty-txt">Add Channel</div>
          </div>
        `}
      </div>
    `;
  }).join('');

  // Re-attach streams to new video elements
  S.multiScreens.forEach((ch, i) => {
    if (ch) attachMultiStream(i, ch);
  });
}

function pickMultiChannel(slot) {
  // Show a small channel picker overlay
  const picker = el('multi-picker');
  if (!picker) return;
  picker.innerHTML = `
    <div class="mp-header">
      <span>SELECT CHANNEL FOR SLOT ${slot + 1}</span>
      <button onclick="el('multi-picker').style.display='none'">✕</button>
    </div>
    <div class="mp-list">
      ${S.channels.slice(0, 60).map(ch => `
        <div class="mp-item" onclick="APP.addMultiScreen(${slot}, '${esc(ch.id)}')">
          <span>${esc(ch.emoji || ch.logo || '📺')}</span>
          <span>${esc(ch.name)}</span>
          <span class="mp-cat">${esc(ch.group || '')}</span>
        </div>
      `).join('')}
    </div>
  `;
  picker.style.display = 'block';
}

function addMultiScreen(slot, channelId) {
  el('multi-picker').style.display = 'none';
  const ch = S.channels.find(c => c.id === channelId);
  if (!ch) return;
  S.multiScreens[slot] = ch;
  renderMultiScreen();
  toast(`Slot ${slot + 1}: ${ch.name}`, 'info', 1800);
}

function removeMultiScreen(slot) {
  // Destroy HLS instance for that slot
  const inst = S._multiHls?.[slot];
  if (inst) { inst.destroy(); delete S._multiHls[slot]; }
  S.multiScreens[slot] = null;
  renderMultiScreen();
}

function attachMultiStream(slot, ch) {
  if (!ch.url) return;
  if (!S._multiHls) S._multiHls = {};
  if (S._multiHls[slot]) { S._multiHls[slot].destroy(); }

  const video = el(`ms-video-${slot}`);
  if (!video) return;

  const url = S.fx.proxy ? `/api/proxy/stream?url=${encodeURIComponent(ch.url)}` : ch.url;

  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    S._multiHls[slot] = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.play().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════
//  CHANNEL BOOKMARKS / NOTES
// ═══════════════════════════════════════════════════════
function setBookmark(channelId, note) {
  if (note) {
    S.bookmarks[channelId] = { note, ts: new Date().toISOString() };
  } else {
    delete S.bookmarks[channelId];
  }
  localStorage.setItem('vhv6_bookmarks', JSON.stringify(S.bookmarks));
  toast(note ? '🔖 Bookmark saved' : '🔖 Bookmark removed', 'info', 1500);
}

function openBookmarkModal(channelId) {
  const ch  = S.channels.find(c => c.id === channelId);
  if (!ch) return;
  const existing = S.bookmarks[channelId]?.note || '';
  const note = prompt(`📝 Note for "${ch.name}":`, existing);
  if (note !== null) setBookmark(channelId, note.trim());
}

function renderBookmarksPage() {
  const cont = el('bookmarks-content');
  if (!cont) return;
  const ids = Object.keys(S.bookmarks);
  if (!ids.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-ico">🔖</div><div class="empty-title">NO BOOKMARKS</div><div class="empty-sub">RIGHT-CLICK A CHANNEL OR USE THE ⋮ MENU TO ADD A NOTE</div></div>`;
    return;
  }
  const chs = ids.map(id => ({
    ch: S.channels.find(c => c.id === id),
    note: S.bookmarks[id].note,
    ts:   S.bookmarks[id].ts,
  })).filter(x => x.ch);

  cont.innerHTML = `<div class="bookmarks-list">${chs.map(({ ch, note, ts }) => `
    <div class="bookmark-item">
      <div class="bm-icon">${esc(ch.emoji || ch.logo?.startsWith('http') ? '📺' : ch.logo || '📺')}</div>
      <div class="bm-info">
        <div class="bm-name">${esc(ch.name)}</div>
        <div class="bm-note">${esc(note)}</div>
        <div class="bm-ts">${new Date(ts).toLocaleDateString()}</div>
      </div>
      <div class="bm-actions">
        <button class="btn-ghost" onclick="APP.openChannel('${esc(ch.id)}')">▶ WATCH</button>
        <button class="btn-ghost" onclick="APP.openBookmarkModal('${esc(ch.id)}')">✏ EDIT</button>
        <button class="btn-ghost" onclick="APP.setBookmark('${esc(ch.id)}','')">✕</button>
      </div>
    </div>
  `).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════
//  BOUQUETS (Channel Groups)
// ═══════════════════════════════════════════════════════
function createBouquet(name, channelIds = []) {
  const bouquet = { id: String(Date.now()), name, channels: channelIds };
  S.bouquets.push(bouquet);
  saveBouquets();
  toast(`📁 Bouquet "${name}" created`, 'success');
  return bouquet;
}

function addToBouquet(bouquetId, channelId) {
  const b = S.bouquets.find(b => b.id === bouquetId);
  if (!b) return;
  if (!b.channels.includes(channelId)) b.channels.push(channelId);
  saveBouquets();
  toast('Added to bouquet', 'success');
}

function deleteBouquet(id) {
  S.bouquets = S.bouquets.filter(b => b.id !== id);
  saveBouquets();
  renderBouquetsPage();
  toast('Bouquet deleted', 'info');
}

function saveBouquets() {
  localStorage.setItem('vhv6_bouquets', JSON.stringify(S.bouquets));
}

function renderBouquetsPage() {
  const cont = el('bouquets-content');
  if (!cont) return;
  if (!S.bouquets.length) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-ico">📁</div><div class="empty-title">NO BOUQUETS</div><div class="empty-sub">CREATE CUSTOM CHANNEL GROUPS FROM YOUR FAVORITES</div>
      <button class="btn-primary" style="margin-top:16px" onclick="APP.promptCreateBouquet()">+ CREATE BOUQUET</button>
    </div>`;
    return;
  }
  cont.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
      <button class="btn-primary" onclick="APP.promptCreateBouquet()">+ NEW BOUQUET</button>
    </div>
    ${S.bouquets.map(b => {
      const chs = b.channels.map(id => S.channels.find(c => c.id === id)).filter(Boolean);
      return `
        <div class="bouquet-card">
          <div class="bq-header">
            <div class="bq-name">📁 ${esc(b.name)}</div>
            <div class="bq-count">${chs.length} channels</div>
            <div class="bq-actions">
              <button class="btn-ghost" onclick="APP.openBouquet('${esc(b.id)}')">OPEN</button>
              <button class="btn-ghost" onclick="APP.deleteBouquet('${esc(b.id)}')">DELETE</button>
            </div>
          </div>
          <div class="bq-preview">
            ${chs.slice(0,8).map(ch => `<div class="bq-ch-chip" onclick="APP.openChannel('${esc(ch.id)}')">${esc(ch.emoji||'📺')} ${esc(ch.name)}</div>`).join('')}
            ${chs.length > 8 ? `<div class="bq-ch-chip">+${chs.length - 8} more</div>` : ''}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function promptCreateBouquet() {
  const name = prompt('Bouquet name:');
  if (name?.trim()) createBouquet(name.trim());
}

function openBouquet(bouquetId) {
  const b = S.bouquets.find(b => b.id === bouquetId);
  if (!b) return;
  // Filter live page to bouquet channels
  const bouquetChs = b.channels.map(id => S.channels.find(c => c.id === id)).filter(Boolean);
  nav('live');
  el('live-grid').innerHTML = bouquetChs.map(buildCard).join('');
  el('live-ch-count').textContent = `${bouquetChs.length} CHANNELS — 📁 ${esc(b.name)}`;
  toast(`📁 Viewing bouquet: ${b.name}`, 'info', 2000);
}

// ═══════════════════════════════════════════════════════
//  IMPORT / EXPORT FAVORITES
// ═══════════════════════════════════════════════════════
function exportFavorites(format = 'json') {
  const favChs = S.channels.filter(c => S.favorites.includes(c.id));
  if (!favChs.length) return toast('No favorites to export', 'warn');

  let content, filename, mime;

  if (format === 'm3u') {
    content = '#EXTM3U\n' + favChs.map(ch =>
      `#EXTINF:-1 tvg-logo="${ch.logo||''}" group-title="${ch.group||'Favorites'}",${ch.name}\n${ch.url||'#'}`
    ).join('\n');
    filename = 'valenhart-favorites.m3u';
    mime = 'text/plain';
  } else {
    content = JSON.stringify(favChs.map(ch => ({
      id: ch.id, name: ch.name, group: ch.group, url: ch.url, logo: ch.logo,
    })), null, 2);
    filename = 'valenhart-favorites.json';
    mime = 'application/json';
  }

  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  toast(`✅ Exported ${favChs.length} favorites as ${format.toUpperCase()}`, 'success');
}

function importFavorites(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      let added = 0;
      if (file.name.endsWith('.m3u') || file.name.endsWith('.m3u8')) {
        // Parse M3U for channel names and match against loaded channels
        const lines = text.split('\n');
        lines.forEach(line => {
          const name = (line.match(/,(.+)$/) || [])[1]?.trim();
          if (name) {
            const ch = S.channels.find(c => c.name.toLowerCase() === name.toLowerCase());
            if (ch && !S.favorites.includes(ch.id)) { S.favorites.push(ch.id); added++; }
          }
        });
      } else {
        // JSON import
        const items = JSON.parse(text);
        items.forEach(item => {
          const ch = S.channels.find(c => c.id === item.id || c.name === item.name);
          if (ch && !S.favorites.includes(ch.id)) { S.favorites.push(ch.id); added++; }
        });
      }
      saveFavs(); renderFavBadge();
      if (S.currentPage === 'favorites') renderFavoritesPage();
      toast(`✅ Imported ${added} favorites`, 'success');
    } catch(err) {
      toast('Import failed: invalid file', 'err');
    }
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════
//  VOD PAGE
// ═══════════════════════════════════════════════════════
function renderVODPage() {
  const cont = el('vod-content');
  if (!cont) return;

  // Extract VOD channels from loaded playlist (groups containing movie/series/vod keywords)
  const vodKeywords = /movie|film|vod|series|serie|cinema|show|catch/i;
  S.vodChannels = S.channels.filter(c => vodKeywords.test(c.group || ''));

  // Also show demo if empty
  if (!S.vodChannels.length && S.channels.length === 0) {
    S.vodChannels = DEMO_CHANNELS.filter(c => /movie|doc|nature/i.test(c.group || ''));
  }

  if (!S.vodChannels.length) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-ico">🎬</div>
      <div class="empty-title">NO VOD CONTENT</div>
      <div class="empty-sub">LOAD A PLAYLIST CONTAINING MOVIES, SERIES, OR VOD GROUPS TO SEE CONTENT HERE</div>
    </div>`;
    return;
  }

  // Genre filter
  const genres = [...new Set(S.vodChannels.map(c => c.group).filter(Boolean))];
  const filtered = S.vodFilter === 'all'
    ? S.vodChannels
    : S.vodChannels.filter(c => c.group === S.vodFilter);

  cont.innerHTML = `
    <div class="vod-filters">
      <div class="cat-pill ${S.vodFilter === 'all' ? 'active' : ''}" onclick="APP.filterVOD('all')">🎬 ALL</div>
      ${genres.slice(0, 12).map(g => `
        <div class="cat-pill ${S.vodFilter === g ? 'active' : ''}" onclick="APP.filterVOD('${esc(g)}')">
          ${getCatIcon(g)} ${esc(g.toUpperCase())}
        </div>
      `).join('')}
    </div>
    <div class="vod-count">${filtered.length} TITLES</div>
    <div class="ch-grid vod-grid">${filtered.map(ch => buildVODCard(ch)).join('')}
    </div>
  `;
}

function buildVODCard(ch) {
  const logo = ch.logo || ch.emoji || '🎬';
  return `
    <div class="ch-card vod-card" onclick="APP.openChannel('${esc(ch.id)}')">
      <div class="ch-thumb" style="aspect-ratio:2/3;min-height:180px">
        ${logo.startsWith('http')
          ? `<img class="ch-thumb-logo" src="${esc(logo)}" loading="lazy" style="object-fit:cover" onerror="this.parentNode.innerHTML='<span class=\\'ch-thumb-fallback\\'>🎬</span>'">`
          : `<span class="ch-thumb-fallback" style="font-size:3rem">${esc(logo)}</span>`}
        <div class="ch-overlay">
          <button class="ch-play-btn" onclick="event.stopPropagation();APP.openChannel('${esc(ch.id)}')">
            <svg viewBox="0 0 12 14" fill="none"><path d="M1 1l10 6L1 13V1z" fill="#050a14"/></svg>
          </button>
          <button class="ch-fav-btn ${S.favorites.includes(ch.id)?'on':''}" data-id="${esc(ch.id)}"
                  onclick="event.stopPropagation();APP.toggleFav('${esc(ch.id)}')">★</button>
        </div>
      </div>
      <div class="ch-info">
        <div class="ch-name">${esc(ch.name)}</div>
        <div class="ch-foot">
          <div class="ch-cat-tag">${esc((ch.group||'VOD').toUpperCase())}</div>
          ${ch.quality ? `<div class="ch-qual-badge" style="position:static;border-radius:2px">${esc(ch.quality)}</div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function filterVOD(genre) {
  S.vodFilter = genre;
  renderVODPage();
}

// ═══════════════════════════════════════════════════════
//  CATCHUP TV (stub — requires provider support)
// ═══════════════════════════════════════════════════════
function renderCatchupPage() {
  const cont = el('catchup-content');
  if (!cont) return;

  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return d;
  });

  cont.innerHTML = `
    <div class="catchup-notice">
      <div class="notice-icon">📺</div>
      <div class="notice-text">
        <strong>Catchup TV</strong> allows you to watch programmes from the past 7 days.
        Availability depends on your IPTV provider supporting the Xtream Codes catchup API.
      </div>
    </div>
    <div class="catchup-date-row">
      ${dates.map(d => {
        const label = d.toDateString() === today.toDateString() ? 'Today'
          : d.toDateString() === new Date(today - 86400000).toDateString() ? 'Yesterday'
          : d.toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' });
        const val = d.toISOString().split('T')[0];
        return `<div class="catchup-date-pill ${S.catchupDate === val ? 'active' : ''}"
                     onclick="APP.selectCatchupDate('${val}')">${label}</div>`;
      }).join('')}
    </div>
    ${S.catchupDate ? `
      <div class="catchup-grid">
        ${S.channels.slice(0, 24).map(ch => `
          <div class="catchup-ch" onclick="APP.openCatchupChannel('${esc(ch.id)}')">
            <div class="catchup-ch-logo">${esc(ch.emoji || '📺')}</div>
            <div class="catchup-ch-name">${esc(ch.name)}</div>
            <div class="catchup-ch-avail">3 programmes</div>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty-state" style="padding:40px">
      <div class="empty-ico">📅</div>
      <div class="empty-title">SELECT A DATE</div>
      <div class="empty-sub">CHOOSE A DATE ABOVE TO SEE AVAILABLE CATCHUP CONTENT</div>
    </div>`}
  `;
}

function selectCatchupDate(dateStr) {
  S.catchupDate = dateStr;
  renderCatchupPage();
}

function openCatchupChannel(channelId) {
  const ch = S.channels.find(c => c.id === channelId);
  if (!ch) return;
  // In a real implementation, this would call the Xtream Codes timeshift API
  // For now, open the live stream with a toast explaining
  openChannel(channelId);
  toast('📺 Catchup: playing live stream (provider catchup API not configured)', 'info', 4000);
}

// ═══════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS PANEL
// ═══════════════════════════════════════════════════════
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const inInput = e.target.matches('input, textarea, select');

    if (e.key === 'Escape')      { closePlayer(); closePlModal(); hideShortcutsPanel(); }
    if (e.key === '?' && !inInput) toggleShortcutsPanel();
    if (inInput) return;

    if (S.currentCh) {
      if (e.key === ' ')           { e.preventDefault(); togglePlay(); }
      if (e.key === 'm')           toggleMute();
      if (e.key === 'f')           toggleFavFromPlayer();
      if (e.key === 's')           toggleStatsHud();
      if (e.key === 'ArrowUp')     { e.preventDefault(); adjustVolume(0.1); }
      if (e.key === 'ArrowDown')   { e.preventDefault(); adjustVolume(-0.1); }
      if (e.key === 'ArrowRight')  autoNextChannel(1);
      if (e.key === 'ArrowLeft')   autoNextChannel(-1);
      if (e.key === 'Enter')       toggleFullscreen();
      if (e.key === 'p')           togglePiP();
      if (e.key === 'n')           autoNextChannel(1);
      if (e.key === 'b')           autoNextChannel(-1);
    }

    // Navigation
    if (e.key === '1') nav('home');
    if (e.key === '2') nav('live');
    if (e.key === '3') nav('vod');
    if (e.key === '4') nav('categories');
    if (e.key === '5') nav('favorites');
    if (e.key === '6') nav('epg');
  });
}

function toggleShortcutsPanel() {
  const panel = el('shortcuts-panel');
  if (!panel) return;
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'flex';
}
function hideShortcutsPanel() {
  const panel = el('shortcuts-panel');
  if (panel) panel.style.display = 'none';
}

function adjustVolume(delta) {
  S.currentVolume = Math.max(0, Math.min(1, S.currentVolume + delta));
  el('hls-video').volume = S.currentVolume;
  const volSlider = el('volume-slider');
  if (volSlider) volSlider.value = S.currentVolume * 100;
  el('pm-mute').textContent = S.currentVolume === 0 ? '🔇' : '🔊';
}

// ═══════════════════════════════════════════════════════
//  AUTO-NEXT CHANNEL
// ═══════════════════════════════════════════════════════
function autoNextChannel(direction = 1) {
  if (!S.currentCh) return;
  const pool = S.filterCat === 'all'
    ? S.channels
    : S.channels.filter(c => c.group === S.filterCat);
  const idx = pool.findIndex(c => c.id === S.currentCh.id);
  if (idx === -1) return;
  const next = pool[(idx + direction + pool.length) % pool.length];
  if (next) { openChannel(next.id); toast(`${direction > 0 ? '⏭' : '⏮'} ${next.name}`, 'info', 1500); }
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
    if (S.activePl) await loadChannels(true);
    else updateNoPlaylistState();
  } catch(e) {
    await loadChannels(true);
  }
}

async function loadChannels(reset = false) {
  if (reset) { S.channels = []; S.channelPage = 1; }
  showPageLoader();
  try {
    const params = new URLSearchParams({ page: S.channelPage, limit: S.channelLimit });
    if (S.filterCat && S.filterCat !== 'all') params.set('category', S.filterCat);
    const data = await api(`/api/channels?${params}`);
    const newChs = data.channels || [];
    S.channels   = reset ? newChs : [...S.channels, ...newChs];
    S.totalChs   = data.total || newChs.length;
    S.viewerCounts = { ...S.viewerCounts, ...(data.viewerCounts || {}) };
    if (reset) await loadCategories();
    renderLivePage(); renderTrending(); updateStats(); updateBadges();
  } catch(e) {
    S.channels   = DEMO_CHANNELS;
    S.totalChs   = DEMO_CHANNELS.length;
    S.categories = buildLocalCategories(DEMO_CHANNELS);
    DEMO_CHANNELS.forEach(c => { S.viewerCounts[c.id] = c.baseViewers + Math.floor(Math.random() * 2000); });
    renderLivePage(); renderTrending(); updateStats();
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
    el('tb-viewers').textContent   = fmtN(d.totalViewers);
    el('stat-viewers').textContent = fmtN(d.totalViewers);
    el('stat-chs').textContent     = d.activeChannels || '—';
    el('stat-cats').textContent    = d.categories || '—';
    el('tb-chs').textContent       = d.activeChannels || '—';
  } catch(e) {}
}

async function loadEPG() {
  try { const epg = await api('/api/epg'); renderEPG(epg); } catch(e) {}
}

function updateStats() {
  el('stat-chs').textContent   = S.totalChs || S.channels.length;
  el('stat-cats').textContent  = S.categories.length;
  el('tb-chs').textContent     = S.totalChs || S.channels.length;
  el('badge-live').textContent = S.totalChs || S.channels.length;
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

// ── PLAYLIST SUBMIT ─────────────────────────────────────
let plModalMode = 'url', fileContent = null;

async function submitPlaylist() {
  const loading = el('pl-loading'), status = el('pl-status'), btn = el('pl-submit-btn');
  loading.classList.add('show');
  status.textContent = 'Loading...'; status.className = 'pl-status'; btn.disabled = true;
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
    await loadChannels(true); renderPlTabs(); renderCategoryPage();
    toast(`✅ ${data.count} channels loaded!`, 'success');
    setTimeout(closePlModal, 1500); nav('live');
  } catch(err) {
    status.textContent = '⚠ ' + (err.message || 'Failed to load playlist');
    status.className   = 'pl-status err';
  } finally {
    loading.classList.remove('show'); btn.disabled = false;
  }
}

function handleFileInput(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    fileContent = e.target.result;
    el('m3u-drop-zone').innerHTML = `<div class="m3u-zone-ico">✅</div><div class="m3u-zone-txt">${esc(file.name)}</div><div class="m3u-zone-sub">${(file.size/1024).toFixed(1)} KB · ready</div>`;
    el('pl-status').textContent = `File ready`; el('pl-status').className = 'pl-status ok';
  };
  reader.readAsText(file);
}

function handleDrop(e) {
  e.preventDefault(); el('m3u-drop-zone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) { const dt = new DataTransfer(); dt.items.add(file); const inp = el('m3u-file-inp'); inp.files = dt.files; handleFileInput(inp); }
}

async function activatePlaylist(id) {
  try {
    await api(`/api/playlists/${id}/activate`, 'POST');
    S.activePl = id; S.playlists.forEach(p => p.active = p.id === id);
    renderPlTabs(); S.filterCat = 'all'; await loadChannels(true); toast('Playlist switched', 'info');
  } catch(e) { toast('Failed to switch playlist', 'err'); }
}

async function deletePlaylist(id) {
  try {
    await api(`/api/playlists/${id}`, 'DELETE');
    S.playlists = S.playlists.filter(p => p.id !== id);
    if (S.activePl === id) { S.activePl = S.playlists[0]?.id || null; await loadChannels(true); }
    renderPlTabs(); toast('Playlist removed', 'info');
  } catch(e) {}
}

async function loadUrlFromSettings() {
  const url = el('url-input-settings').value.trim(), name = el('pl-name-settings').value.trim();
  if (!url) return toast('Enter a URL', 'warn');
  el('pl-url-inp').value = url; el('pl-name-inp').value = name; plModalMode = 'url';
  await submitPlaylist();
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════
function renderHomePage() { renderRecentRow(); renderTrending(); updateHeroFeatured(); }

function updateHeroFeatured() {
  if (!S.channels.length) return;
  const top = S.channels.slice().sort((a,b) => (S.viewerCounts[b.id]||0) - (S.viewerCounts[a.id]||0))[0];
  const logo = top.logo || top.emoji || '📺';
  el('hero-ch-disp').innerHTML = `
    ${logo.startsWith('http') ? `<img src="${esc(logo)}" class="hero-ch-logo" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hero-ch-logo',textContent:'📺'}))">` : `<span class="hero-ch-logo">${esc(logo)}</span>`}
    <div class="hero-ch-name">${esc(top.name)}</div>
    <div class="hero-ch-prog">${esc(top.prog || top.group || 'LIVE')}</div>
  `;
  el('hero-ch-lbl').textContent    = top.name;
  el('hero-view-cnt').textContent  = '👁 ' + fmtN(S.viewerCounts[top.id] || top.baseViewers || 0) + ' watching';
}

function renderTrending() {
  const sorted = S.channels.slice().sort((a,b) =>
    (S.viewerCounts[b.id]||b.baseViewers||0) - (S.viewerCounts[a.id]||a.baseViewers||0)
  ).slice(0,8);
  el('trending-grid').innerHTML = sorted.map(buildCard).join('');
}

function renderRecentRow() {
  const row = el('recent-row'), sec = el('sec-recent');
  if (!S.recent.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const chs = S.recent.map(id => S.channels.find(c => c.id === id)).filter(Boolean);
  if (!chs.length) { sec.style.display = 'none'; return; }
  row.innerHTML = chs.map((ch, i) => {
    const logo = ch.logo || ch.emoji || '📺';
    return `<div class="rw-card" onclick="APP.openChannel('${esc(ch.id)}')">
      <div class="rw-thumb">
        ${logo.startsWith('http') ? `<img src="${esc(logo)}" onerror="this.style.display='none'">` : `<span>${esc(logo)}</span>`}
        <div class="ch-live-badge" style="position:absolute;top:6px;left:6px"><div style="width:4px;height:4px;border-radius:50%;background:#fff;display:inline-block"></div> LIVE</div>
      </div>
      <div class="rw-prog-bar"><div class="rw-prog-fill" style="width:${15+i*8}%"></div></div>
      <div class="rw-info">
        <div class="rw-name">${esc(ch.name)}</div>
        <div class="rw-sub">${esc((ch.group||'LIVE').toUpperCase())} · ${esc(ch.quality||'HD')}</div>
      </div>
    </div>`;
  }).join('');
}

function renderLivePage() {
  const hasChs = S.channels.length > 0;
  el('no-playlist-msg').style.display = hasChs ? 'none' : '';
  el('live-main').style.display       = hasChs ? 'block' : 'none';
  if (!hasChs) return;
  el('live-ch-count').textContent = `${S.totalChs || S.channels.length} CHANNELS`;
  renderCatPills();
  el('live-grid').innerHTML = S.channels.map(buildCard).join('');
  el('load-more-wrap').style.display = S.channels.length < S.totalChs ? 'block' : 'none';
}

function renderCatPills() {
  const row = el('live-cat-row');
  const cats = [{ name:'all', count: S.totalChs }, ...S.categories.slice(0,20)];
  const pinnedFirst = [
    ...cats.filter(c => S.pinnedCategories.includes(c.name)),
    ...cats.filter(c => !S.pinnedCategories.includes(c.name)),
  ];
  row.innerHTML = pinnedFirst.map(c => `
    <div class="cat-pill ${S.filterCat === c.name ? 'active' : ''} ${S.pinnedCategories.includes(c.name) ? 'pinned' : ''}"
         onclick="APP.filterByCategory('${esc(c.name)}')"
         oncontextmenu="event.preventDefault();APP.togglePinCategory('${esc(c.name)}')">
      ${getCatIcon(c.name)} ${c.name === 'all' ? 'ALL' : esc(c.name.toUpperCase())}
      <span class="cnt">${c.count || ''}</span>
      ${S.pinnedCategories.includes(c.name) ? '<span style="font-size:.6rem;margin-left:2px">📌</span>' : ''}
    </div>
  `).join('');
}

function togglePinCategory(name) {
  if (name === 'all') return;
  const idx = S.pinnedCategories.indexOf(name);
  if (idx >= 0) S.pinnedCategories.splice(idx, 1);
  else S.pinnedCategories.push(name);
  localStorage.setItem('vhv6_pinned_cats', JSON.stringify(S.pinnedCategories));
  renderCatPills();
  toast(idx >= 0 ? 'Category unpinned' : '📌 Category pinned', 'info', 1500);
}

function renderCategoryPage() {
  const grid = el('cat-grid'), count = el('cat-count');
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
    cont.innerHTML = `<div class="empty-state"><div class="empty-ico">★</div><div class="empty-title">NO FAVORITES YET</div><div class="empty-sub">HOVER A CHANNEL AND PRESS ★</div></div>`;
    return;
  }

  // Export buttons
  cont.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <button class="btn-ghost" onclick="APP.exportFavorites('json')">⬇ EXPORT JSON</button>
      <button class="btn-ghost" onclick="APP.exportFavorites('m3u')">⬇ EXPORT M3U</button>
      <label class="btn-ghost" style="cursor:pointer">
        ⬆ IMPORT
        <input type="file" accept=".json,.m3u,.m3u8" style="display:none"
               onchange="APP.importFavorites(this.files[0])">
      </label>
      <button class="btn-ghost" onclick="APP.promptCreateBouquet()">📁 CREATE BOUQUET</button>
    </div>
    <div class="ch-grid">${favChs.map(buildCard).join('')}</div>
  `;
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
          <div class="epg-prog ${p.isNow?'now':''}" style="--flex:${p.duration/60}"
               onclick="APP.openChannelByName('${esc(row.channelName)}')">
            <div class="epg-prog-name">${esc(p.title)}</div>
            <div class="epg-prog-time">${p.start} · ${p.duration}m</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  });
  el('epg-table').innerHTML = html;
}

// ═══════════════════════════════════════════════════════
//  CHANNEL CARD
// ═══════════════════════════════════════════════════════
function buildCard(ch) {
  const isFav   = S.favorites.includes(ch.id);
  const hasBm   = !!S.bookmarks[ch.id];
  const viewers = S.viewerCounts[ch.id] || ch.baseViewers || 0;
  const logo    = ch.logo || ch.emoji || '📺';
  const logoHtml = logo.startsWith('http')
    ? `<img class="ch-thumb-logo" src="${esc(logo)}" loading="lazy"
           onerror="this.parentNode.innerHTML='<span class=\\'ch-thumb-fallback\\'>${getCatIcon(ch.group||'')}</span>'+this.parentNode.innerHTML.replace(/<img[^>]*>/,'');">`
    : `<span class="ch-thumb-fallback">${esc(logo)}</span>`;

  return `
    <div class="ch-card ${isFav?'in-wl':''}" data-id="${esc(ch.id)}" onclick="APP.openChannel('${esc(ch.id)}')">
      <div class="ch-thumb">
        ${logoHtml}
        <div class="ch-live-badge"><div style="width:4px;height:4px;border-radius:50%;background:#fff;display:inline-block;margin-right:2px"></div>LIVE</div>
        ${ch.quality ? `<div class="ch-qual-badge">${esc(ch.quality)}</div>` : ''}
        ${hasBm ? `<div style="position:absolute;top:7px;right:${ch.quality?'52px':'7px'};font-size:.7rem;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:3px">🔖</div>` : ''}
        <div class="ch-overlay">
          <button class="ch-play-btn" onclick="event.stopPropagation();APP.openChannel('${esc(ch.id)}')">
            <svg viewBox="0 0 12 14" fill="none"><path d="M1 1l10 6L1 13V1z" fill="#050a14"/></svg>
          </button>
          <button class="ch-fav-btn ${isFav?'on':''}" data-id="${esc(ch.id)}"
                  title="${isFav?'Remove':'Add to favorites'}"
                  onclick="event.stopPropagation();APP.toggleFav('${esc(ch.id)}')">★</button>
          <button class="ch-fav-btn" style="margin-left:4px"
                  title="Bookmark / Note"
                  onclick="event.stopPropagation();APP.openBookmarkModal('${esc(ch.id)}')">🔖</button>
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
    if (id && S.viewerCounts[id])
      el.innerHTML = `<span class="ch-viewers-dot">●</span> ${fmtN(S.viewerCounts[id])}`;
  });
}

// ═══════════════════════════════════════════════════════
//  CHANNEL OPEN / HLS PLAYER
// ═══════════════════════════════════════════════════════
async function openChannel(id) {
  if (S.pinLocked) { checkParentalLock(() => openChannel(id)); return; }

  const ch = S.channels.find(c => c.id === id);
  if (!ch) return;
  S.currentCh  = ch; S.usingProxy = false;
  S.recent = [id, ...S.recent.filter(r => r !== id)].slice(0, 15);
  localStorage.setItem('vhv6_recent', JSON.stringify(S.recent));
  renderRecentRow();

  if (S.socket) S.socket.emit('join_channel', id);
  fillPlayerUI(ch);
  el('player-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
  showPlayerLoading('CONNECTING TO STREAM...');
  await startStream(ch.url, ch);
  loadRatings(id);
  renderTrackMenus();
  renderQualityMenu();
  if (S.fx.statsHud) startStatsHud();
  sfx();
}

function openChannelByName(name) {
  const ch = S.channels.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (ch) openChannel(ch.id);
  else toast(`Channel not found: ${name}`, 'warn');
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
  el('pm-fav').classList.toggle('on', S.favorites.includes(ch.id));
  el('pm-fav').textContent      = S.favorites.includes(ch.id) ? '★ FAVORITED' : '★ FAVORITE';
  el('mini-logo').textContent   = logo.startsWith('http') ? '📺' : logo;
  el('mini-name').textContent   = ch.name;
  el('mini-prog').textContent   = ch.group || 'LIVE';
}

async function startStream(url, ch) {
  if (!url) { showPlayerError('NO STREAM URL', 'This channel has no stream URL configured.'); return; }
  showPlayerLoading('INITIALIZING STREAM...'); hidePlayerError();
  if (S.hlsInstance)  { S.hlsInstance.destroy();  S.hlsInstance  = null; }
  if (S.dashInstance) { S.dashInstance.destroy(); S.dashInstance = null; }
  if (S.flvInstance)  { S.flvInstance.destroy();  S.flvInstance  = null; }
  stopStatsHud();

  const video = el('hls-video');
  video.pause(); video.removeAttribute('src'); video.load();

  const streamUrl = (S.fx.proxy && url.startsWith('http'))
    ? `/api/proxy/stream?url=${encodeURIComponent(url)}` : url;

  const urlBase  = url.split('?')[0].toLowerCase();
  const isHLS    = urlBase.includes('.m3u8') || urlBase.includes('m3u8');
  const isDASH   = urlBase.includes('.mpd');
  const isFLV    = urlBase.includes('.flv');
  const isTS     = /\.(ts|mts|m2ts)(\?|$)/.test(urlBase);
  const isNative = /\.(mp4|webm|ogg|ogv|mov|3gp|mp3|aac|flac|wav|opus)(\?|$)/.test(urlBase);
  const hasNoExt = !/\.[a-z0-9]{2,5}(\?|$)/.test(urlBase);

  function onPlaySuccess() {
    hidePlayerLoading(); S.isPlaying = true;
    el('pm-pp-btn').textContent = '⏸ PAUSE'; animateSeekbar();
    toast(`📺 ${ch.name}`, 'info', 2500);
    renderTrackMenus(); renderQualityMenu();
    if (S.fx.statsHud) startStatsHud();
    // Autoplay next on stream end
    if (S.fx.autoNext) {
      video.addEventListener('ended', () => autoNextChannel(1), { once: true });
    }
  }

  function onFatalError(code, detail) {
    if (!S.usingProxy && S.fx.proxy) { S.usingProxy = true; startStream(url, ch); }
    else showPlayerError(code, detail);
  }

  if ((isHLS || isTS || hasNoExt) && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
    S.hlsInstance = hls;
    hls.loadSource(streamUrl); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(()=>{}); onPlaySuccess(); });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) { hls.destroy(); S.hlsInstance = null; onFatalError('HLS ERROR', `${data.type}: ${data.details}`); }
    });
  } else if ((isHLS || isTS || hasNoExt) && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => { video.play().catch(()=>{}); onPlaySuccess(); }, { once: true });
    video.addEventListener('error', () => onFatalError('HLS ERROR', 'Could not load stream'), { once: true });
  } else if (isDASH && typeof dashjs !== 'undefined') {
    const dash = dashjs.MediaPlayer().create();
    dash.initialize(video, streamUrl, true);
    dash.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, onPlaySuccess);
    dash.on(dashjs.MediaPlayer.events.ERROR, e => onFatalError('DASH ERROR', e.error?.message || 'DASH error'));
    S.dashInstance = dash;
  } else if (isFLV && typeof flvjs !== 'undefined' && flvjs.isSupported()) {
    const flv = flvjs.createPlayer({ type: 'flv', url: streamUrl });
    flv.attachMediaElement(video); flv.load(); flv.play();
    flv.on(flvjs.Events.MEDIA_INFO, onPlaySuccess);
    flv.on(flvjs.Events.ERROR, (_, d) => { flv.destroy(); S.flvInstance = null; onFatalError('FLV ERROR', d); });
    S.flvInstance = flv;
  } else {
    video.src = streamUrl; video.load();
    video.addEventListener('loadedmetadata', () => { video.play().catch(()=>{}); onPlaySuccess(); }, { once: true });
    video.addEventListener('error', () => {
      const code = video.error?.code;
      if (code === 4 && Hls.isSupported()) {
        video.removeAttribute('src'); video.load();
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        S.hlsInstance = hls; hls.loadSource(streamUrl); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(()=>{}); onPlaySuccess(); });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { hls.destroy(); S.hlsInstance = null; onFatalError('PLAYBACK ERROR', 'Format not supported'); } });
      } else {
        const errMap = { 1:'Aborted', 2:'Network error', 3:'Decode error', 4:'Format not supported' };
        onFatalError('PLAYBACK ERROR', errMap[code] || 'Unknown error');
      }
    }, { once: true });
  }
}

function showPlayerLoading(txt='LOADING...') { el('pm-loading').classList.remove('hidden'); el('pm-loading-txt').textContent = txt; el('pm-center').classList.add('hidden'); hidePlayerError(); }
function hidePlayerLoading()               { el('pm-loading').classList.add('hidden'); el('pm-center').classList.remove('hidden'); }
function showPlayerError(code, msg)        { hidePlayerLoading(); el('pm-err').classList.add('show'); el('pm-err-msg').textContent = msg||''; el('pm-err').querySelector('.pm-err-code').textContent = code||'ERROR'; }
function hidePlayerError()                 { el('pm-err').classList.remove('show'); }
function retryStream()                     { if (S.currentCh) startStream(S.currentCh.url, S.currentCh); }
async function tryProxy()                  { if (!S.currentCh) return; S.usingProxy = true; S.fx.proxy = true; await startStream(S.currentCh.url, S.currentCh); toast('Retrying with server proxy...', 'info'); }

function closePlayer() {
  el('player-modal').classList.remove('show');
  document.body.style.overflow = '';
  const video = el('hls-video');
  video.pause();
  if (S.hlsInstance)  { S.hlsInstance.destroy();  S.hlsInstance  = null; }
  if (S.dashInstance) { S.dashInstance.destroy(); S.dashInstance = null; }
  if (S.flvInstance)  { S.flvInstance.destroy();  S.flvInstance  = null; }
  video.removeAttribute('src'); video.load();
  S.isPlaying = false;
  stopStatsHud();
}

function miniMode()    { closePlayer(); el('mini-player').classList.add('show'); }
function closeMini()   { el('mini-player').classList.remove('show'); }
function reopenPlayer() { el('mini-player').classList.remove('show'); if (S.currentCh) openChannel(S.currentCh.id); }

// ── PLAYBACK CONTROLS ─────────────────────────────────
function togglePlay() {
  const v = el('hls-video');
  if (v.paused) { v.play(); S.isPlaying = true; el('pm-pp-btn').textContent = '⏸ PAUSE'; }
  else          { v.pause(); S.isPlaying = false; el('pm-pp-btn').textContent = '▶ PLAY'; }
}
function toggleMute() {
  S.isMuted = !S.isMuted;
  el('hls-video').muted = S.isMuted;
  el('pm-mute').textContent = S.isMuted ? '🔇' : '🔊';
  const vs = el('volume-slider');
  if (vs) vs.value = S.isMuted ? 0 : S.currentVolume * 100;
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
  clearInterval(seekTimer); let pct = 35;
  seekTimer = setInterval(() => { if (!S.isPlaying) return; pct = Math.min(98.5, pct+0.04); el('pm-seek-fill').style.width = pct+'%'; }, 600);
}

// ── RATINGS ──────────────────────────────────────────
async function loadRatings(id) {
  try { const d = await api(`/api/ratings/${id}`); setRatingUI(d.up, d.down); }
  catch(e) { setRatingUI(Math.floor(Math.random()*500)+50, Math.floor(Math.random()*20)); }
}
function setRatingUI(up, down) { el('pm-up-n').textContent = fmtN(up); el('pm-dn-n').textContent = fmtN(down); }
async function rate(vote) {
  if (!S.currentCh) return;
  try { const d = await api(`/api/ratings/${S.currentCh.id}`, 'POST', { vote }); setRatingUI(d.up, d.down); el(vote==='up'?'pm-up':'pm-down').classList.add('voted'); toast(vote==='up'?'👍 Liked!':'👎 Disliked', 'info', 1500); }
  catch(e) {}
}

// ── FAVORITES ─────────────────────────────────────────
function toggleFav(id) {
  if (S.socket) { S.socket.emit('toggle_watchlist', id); }
  else {
    const idx = S.favorites.indexOf(id);
    if (idx >= 0) { S.favorites.splice(idx,1); toast('☆ Removed', 'info'); }
    else          { S.favorites.push(id);      toast('★ Favorited', 'success'); }
    saveFavs(); renderFavBadge();
    if (S.currentPage === 'favorites') renderFavoritesPage();
  }
  sfx();
}
function toggleFavFromPlayer() { if (S.currentCh) toggleFav(S.currentCh.id); }
function saveFavs() { localStorage.setItem('vhv6_favs', JSON.stringify(S.favorites)); }
function renderFavBadge() {
  const n = S.favorites.length;
  el('badge-fav').textContent = n; el('badge-fav').style.display = n > 0 ? '' : 'none';
}
function updateBadges() { renderFavBadge(); el('badge-live').textContent = S.totalChs || S.channels.length || '—'; }
function clearFavorites() {
  S.favorites = []; saveFavs(); renderFavBadge(); renderFavoritesPage();
  if (S.socket) S.socket.emit('toggle_watchlist', '__clear__');
  toast('Favorites cleared', 'info');
}

// ── CHAT ────────────────────────────────────────────────
function sendChat() {
  const inp = el('chat-inp'), msg = inp.value.trim();
  if (!msg || !S.currentCh) return;
  if (S.socket) S.socket.emit('chat_message', { channelId: S.currentCh.id, message: msg });
  else renderChatMsg({ user: S.username||'You', avatar: S.avatar, message: msg, ts: new Date().toISOString() });
  inp.value = '';
}
function renderChatMsg(msg) {
  const box = el('chat-msgs'), d = document.createElement('div');
  d.className = 'chat-msg';
  d.innerHTML = `<div class="chat-avatar">${esc(msg.avatar||'🎭')}</div><div><div class="chat-user">${esc(msg.user)}</div><div class="chat-text">${esc(msg.message)}</div></div>`;
  box.appendChild(d);
}

// ── SEARCH ──────────────────────────────────────────────
async function handleSearch(e) {
  const q = e.target ? e.target.value.trim() : '';
  const dd = el('search-dd'), x = el('search-x');
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
        return `<div class="sd-item" onclick="APP.openChannel('${esc(ch.id)}');APP.clearSearch()">
          <div class="sd-logo">${logo.startsWith('http') ? `<img src="${esc(logo)}" style="width:100%;height:100%;object-fit:contain;border-radius:3px">` : esc(logo)}</div>
          <div class="sd-info"><div class="sd-name">${esc(ch.name)}</div><div class="sd-group">${esc(ch.group||'LIVE')}</div></div>
        </div>`;
      }).join('');
    }
    dd.classList.add('show');
  } catch(e) {
    const q2  = q.toLowerCase();
    const res = S.channels.filter(c => c.name.toLowerCase().includes(q2)||(c.group||'').toLowerCase().includes(q2)).slice(0,10);
    dd.innerHTML = res.length ? res.map(ch => `<div class="sd-item" onclick="APP.openChannel('${esc(ch.id)}');APP.clearSearch()"><div class="sd-logo">${esc(ch.emoji||ch.logo||'📺')}</div><div class="sd-info"><div class="sd-name">${esc(ch.name)}</div><div class="sd-group">${esc(ch.group||'LIVE')}</div></div></div>`).join('') : `<div class="sd-empty">NO RESULTS</div>`;
    dd.classList.add('show');
  }
}

function clearSearch() { el('search-inp').value = ''; el('search-x').style.display = 'none'; el('search-dd').classList.remove('show'); }

// ── FILTERING ──────────────────────────────────────────
async function filterByCategory(cat) { S.filterCat = cat; S.channelPage = 1; await loadChannels(true); sfx(); }
function openCategory(name) { nav('live'); filterByCategory(name); }
async function loadMoreChannels() { S.channelPage++; await loadChannels(false); }
function clearRecent() { S.recent = []; localStorage.removeItem('vhv6_recent'); renderRecentRow(); toast('History cleared', 'info'); }

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
const CRUMBS = {
  home:'HOME', live:'LIVE TV', vod:'VOD / MOVIES', categories:'CATEGORIES',
  favorites:'FAVORITES', epg:'SCHEDULE', settings:'SETTINGS',
  technologies:'TECHNOLOGIES', multiscreen:'MULTI-SCREEN',
  bookmarks:'BOOKMARKS', bouquets:'BOUQUETS', catchup:'CATCHUP TV',
};

function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  const pg = el('page-' + page);
  if (pg) pg.classList.add('active');
  const si = document.querySelector(`.sb-item[data-page="${page}"]`);
  if (si) si.classList.add('active');

  document.querySelectorAll('.bnav-item').forEach(i => i.classList.remove('active'));
  const bi = document.querySelector(`.bnav-item[data-bnav="${page}"]`);
  if (bi) bi.classList.add('active');

  el('crumb').innerHTML = `SYS / <em>${CRUMBS[page] || page.toUpperCase()}</em>`;
  S.currentPage = page;

  if (page === 'home')        renderHomePage();
  if (page === 'live')        renderLivePage();
  if (page === 'vod')         renderVODPage();
  if (page === 'categories')  renderCategoryPage();
  if (page === 'favorites')   renderFavoritesPage();
  if (page === 'epg')         loadEPG();
  if (page === 'technologies') renderTechnologiesPage();
  if (page === 'multiscreen') renderMultiScreen();
  if (page === 'bookmarks')   renderBookmarksPage();
  if (page === 'bouquets')    renderBouquetsPage();
  if (page === 'catchup')     renderCatchupPage();

  el('sidebar').classList.remove('mobile-open');
  sfx();
}

// ── TECHNOLOGIES ────────────────────────────────────────
let _techData = null;
async function renderTechnologiesPage() {
  const container = el('tech-sections'); if (!container) return;
  if (_techData) { _renderTechSections(container, _techData); return; }
  container.innerHTML = `<div class="empty-state"><div class="pm-spinner"></div></div>`;
  try {
    const r = await fetch('/data/iptv-technologies.json'); if (!r.ok) throw new Error('Failed');
    _techData = await r.json(); _renderTechSections(container, _techData);
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-ico">⚠</div><div class="empty-title">FAILED TO LOAD</div></div>`;
  }
}
function _renderTechSections(container, data) {
  container.innerHTML = data.sections.map(sec => `
    <div class="tech-section">
      <div class="tech-section-head">
        <div class="tech-section-icon">${sec.icon}</div>
        <div class="tech-section-meta">
          <div class="tech-section-title">${sec.title}</div>
          <div class="tech-section-desc">${sec.description}</div>
        </div>
      </div>
      <div class="tech-items-grid">
        ${sec.items.map(item => `<div class="tech-item"><div class="tech-item-name">${item.name}</div><div class="tech-item-desc">${item.description}</div></div>`).join('')}
      </div>
    </div>
  `).join('');
}

// ── USER CLICK (logout) ──────────────────────────────────
async function handleUserClick() {
  const user = window.VH?.getUser?.(); if (!user) return;
  if (!confirm(`Sign out as ${user.username}?`)) return;
  await window.VH.logout();
  el('tb-name').textContent = 'GUEST'; el('tb-avatar').textContent = '🎭';
  toast('Signed out', 'info'); setTimeout(() => location.reload(), 800);
}

// ── SIDEBAR ────────────────────────────────────────────
let sbCollapsed = false;
function toggleSidebar() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) { el('sidebar').classList.toggle('mobile-open'); }
  else {
    sbCollapsed = !sbCollapsed;
    el('sidebar').classList.toggle('collapsed', sbCollapsed);
    document.body.classList.toggle('sb-collapsed', sbCollapsed);
    el('sb-toggle').textContent = sbCollapsed ? '▶' : '◀';
  }
}

// ── PLAYLIST MODAL ────────────────────────────────────
function openPlModal()  { el('pl-modal').classList.add('show'); el('pl-status').textContent = ''; }
function closePlModal() { el('pl-modal').classList.remove('show'); fileContent = null; }
function plModalTab(mode, btn) {
  plModalMode = mode;
  document.querySelectorAll('.pl-modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pl-modal-tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active'); el('pl-tab-' + mode).classList.add('active');
  el('pl-status').textContent = '';
}

// ── SETTINGS ─────────────────────────────────────────
function setSettingsTab(btn) {
  document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
  btn.classList.add('active');
}
function toggleFx(key, btn) {
  btn.classList.toggle('on'); S.fx[key] = btn.classList.contains('on');
  if (key === 'scanlines') el('scanlines').style.display = S.fx.scanlines ? '' : 'none';
  localStorage.setItem('vhv6_fx', JSON.stringify(S.fx));
}
function loadFxPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('vhv6_fx') || '{}');
    Object.assign(S.fx, saved);
    if (!S.fx.scanlines) el('scanlines').style.display = 'none';
    ['particles','scanlines','sfx','proxy','autoplay','autoNext','statsHud','subtitles'].forEach(k => {
      const t = el('t-' + k); if (t) t.classList.toggle('on', !!S.fx[k]);
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════
function startParticles() {
  const cvs = document.getElementById('bg-canvas'), ctx = cvs.getContext('2d');
  let W, H, pts = [];
  const resize = () => { W = cvs.width = innerWidth; H = cvs.height = innerHeight; };
  resize(); addEventListener('resize', resize);
  class Pt {
    constructor() { this.r(); }
    r() { this.x = Math.random()*W; this.y = Math.random()*H; this.sz = Math.random()*1.4+0.2; this.vx = (Math.random()-.5)*.35; this.vy = (Math.random()-.5)*.35; this.op = Math.random()*.45+.08; this.h = Math.random()>.65?280:195; }
    step() { this.x += this.vx; this.y += this.vy; if (this.x<0||this.x>W||this.y<0||this.y>H) this.r(); }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,this.sz,0,Math.PI*2); ctx.fillStyle = `hsla(${this.h},100%,70%,${this.op})`; ctx.fill(); }
  }
  for (let i = 0; i < 100; i++) pts.push(new Pt());
  const links = () => { for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) { const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy); if (d<90) { ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y); ctx.strokeStyle=`rgba(0,212,255,${.035*(1-d/90)})`; ctx.lineWidth=.5; ctx.stroke(); } } };
  const loop = () => { requestAnimationFrame(loop); if (!S.fx.particles) return; ctx.clearRect(0,0,W,H); links(); pts.forEach(p => { p.step(); p.draw(); }); };
  loop();
}

// ═══════════════════════════════════════════════════════
//  EPG CLOCK
// ═══════════════════════════════════════════════════════
function startEPGClock() {
  const tick = () => { const n=new Date(); el('epg-clock').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`; };
  tick(); setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
function toast(msg, type='info', dur=3200) {
  const icons = { success:'✅', warn:'⚠️', info:'ℹ️', err:'❌' };
  const stack = el('toasts'), t = document.createElement('div');
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
    const osc=_actx.createOscillator(), g=_actx.createGain();
    osc.connect(g); g.connect(_actx.destination);
    osc.frequency.setValueAtTime(880,_actx.currentTime); osc.frequency.exponentialRampToValueAtTime(440,_actx.currentTime+.1);
    g.gain.setValueAtTime(.08,_actx.currentTime); g.gain.exponentialRampToValueAtTime(.001,_actx.currentTime+.15);
    osc.start(); osc.stop(_actx.currentTime+.15);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════
//  API
// ═══════════════════════════════════════════════════════
async function api(url, method='GET', body=null) {
  const opts = { method, headers: { 'Content-Type':'application/json', 'X-Socket-Id': S.socketId||'anon' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts), data = await res.json();
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
function debounce(fn, ms) { let t; return function(...a) { clearTimeout(t); t = setTimeout(()=>fn.apply(this,a),ms); }; }
function getCatIcon(cat) {
  const c = (cat||'').toLowerCase();
  if (/sport|foot|soccer|basket|tennis|golf|rugby|sport/.test(c)) return '⚽';
  if (/news|info/.test(c)) return '📡';
  if (/movie|film|cinema|cine/.test(c)) return '🎬';
  if (/music|mtv|trace/.test(c)) return '🎵';
  if (/kids|child|junior|cartoon|nickel|disney/.test(c)) return '🧸';
  if (/doc|discovery|national|nat geo/.test(c)) return '🔬';
  if (/nature|wild|animal/.test(c)) return '🌿';
  if (/game|gaming/.test(c)) return '🎮';
  if (/anime|manga/.test(c)) return '⚔️';
  if (/series|serie|show/.test(c)) return '📺';
  if (/entertain|general/.test(c)) return '🎭';
  return '📺';
}
function buildLocalCategories(channels) {
  const map = {};
  channels.forEach(c => { const g=c.group||c.genre||'Other'; map[g]=(map[g]||0)+1; });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
}
function randomAvatar() { return ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆'][Math.floor(Math.random()*14)]; }
function showPageLoader() { el('pg-bar').style.opacity='1'; el('pg-bar').style.width='70%'; }

// ═══════════════════════════════════════════════════════
//  DEMO CHANNELS
// ═══════════════════════════════════════════════════════
const DEMO_CHANNELS = [
  {id:'d1', name:'beIN SPORTS 1',    group:'Sport',       emoji:'⚽', baseViewers:32000, prog:'Champions League',    time:'21:00', quality:'HD',  country:'QA', url:''},
  {id:'d2', name:'ESPN HD',          group:'Sport',       emoji:'🏀', baseViewers:18000, prog:'NBA Playoffs',        time:'20:00', quality:'HD',  country:'US', url:''},
  {id:'d3', name:'Sky Sports',       group:'Sport',       emoji:'🏏', baseViewers:14000, prog:'Ashes Test',          time:'10:00', quality:'4K',  country:'GB', url:''},
  {id:'d4', name:'France 24',        group:'News',        emoji:'📡', baseViewers:5600,  prog:'World News',          time:'20:00', quality:'HD',  country:'FR', url:''},
  {id:'d5', name:'BBC World News',   group:'News',        emoji:'🌐', baseViewers:8000,  prog:'Global Report',       time:'21:00', quality:'HD',  country:'GB', url:''},
  {id:'d6', name:'CNN International',group:'News',        emoji:'🗞', baseViewers:11000, prog:'Breaking News',       time:'19:00', quality:'HD',  country:'US', url:''},
  {id:'d7', name:'Canal+ Cinéma',    group:'Movies',      emoji:'🎬', baseViewers:7800,  prog:'Dune: Part Two',      time:'21:00', quality:'4K',  country:'FR', url:''},
  {id:'d8', name:'HBO Max',          group:'Movies',      emoji:'🍿', baseViewers:22000, prog:'House of the Dragon', time:'22:00', quality:'4K',  country:'US', url:''},
  {id:'d9', name:'Nickelodeon',      group:'Kids',        emoji:'🧸', baseViewers:4100,  prog:'SpongeBob',           time:'18:00', quality:'HD',  country:'US', url:''},
  {id:'d10',name:'Cartoon Network',  group:'Kids',        emoji:'🎨', baseViewers:3800,  prog:'Ben 10',              time:'17:00', quality:'HD',  country:'US', url:''},
  {id:'d11',name:'MTV HD',           group:'Music',       emoji:'🎵', baseViewers:9000,  prog:'Top 100',             time:'19:00', quality:'HD',  country:'US', url:''},
  {id:'d12',name:'NatGeo Wild',      group:'Nature',      emoji:'🌿', baseViewers:3100,  prog:'Planet Earth IV',     time:'20:30', quality:'4K',  country:'US', url:''},
  {id:'d13',name:'Discovery+',       group:'Documentary', emoji:'🔬', baseViewers:2300,  prog:'Space Frontier',      time:'22:00', quality:'4K',  country:'US', url:''},
  {id:'d14',name:'Eurosport 1',      group:'Sport',       emoji:'🚴', baseViewers:6200,  prog:'Tour de France',      time:'14:00', quality:'HD',  country:'EU', url:''},
  {id:'d15',name:'Trace Africa',     group:'Music',       emoji:'🥁', baseViewers:3600,  prog:'Afrobeats Top 50',    time:'19:00', quality:'HD',  country:'CM', url:''},
  {id:'d16',name:'Al Jazeera',       group:'News',        emoji:'📺', baseViewers:7000,  prog:'Inside Story',        time:'22:00', quality:'HD',  country:'QA', url:''},
];

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', init);

// ── PUBLIC API ───────────────────────────────────────────
return {
  nav, toggleSidebar, toggleTheme,
  openChannel, openChannelByName, closePlayer, retryStream, tryProxy,
  togglePlay, toggleMute, toggleFullscreen, togglePiP, adjustVolume,
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
  renderTechnologiesPage,
  handleUserClick,
  // New features
  setSleepTimer, clearSleepTimer,
  setAudioTrack, setSubTrack, setQualityLevel,
  toggleStatsHud,
  startCast, startAirPlay,
  openMultiScreen, addMultiScreen, removeMultiScreen, pickMultiChannel,
  openBookmarkModal, setBookmark, renderBookmarksPage,
  createBouquet, deleteBouquet, openBouquet, addToBouquet, promptCreateBouquet,
  exportFavorites, importFavorites,
  filterVOD,
  selectCatchupDate, openCatchupChannel,
  toggleShortcutsPanel, hideShortcutsPanel,
  setPIN, lockParental, unlockParental,
  togglePinCategory,
  autoNextChannel,
};

})(); // APP IIFE
