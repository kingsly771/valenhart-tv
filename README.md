# VALENHART TV v3.0
### By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗

> A fully functional, production-ready IPTV platform with M3U support, HLS playback, real-time chat, and a premium game-style UI.

---

## 🚀 Quick Start

```bash
npm install
npm start
# → http://localhost:3000
```

---

## 📡 Loading Your IPTV Playlist

### Option A — From the UI (Recommended)
1. Click **`+ ADD PLAYLIST`** in the sidebar or Live TV page
2. Choose **"FROM URL"** and paste your M3U URL
3. Or choose **"UPLOAD FILE"** and drag your `.m3u` file

### Option B — Settings Page
1. Go to ⚙ Settings → Playlists
2. Enter M3U URL and click **LOAD PLAYLIST**

### Option C — From Settings Settings input
Works the same way; useful for quick re-loading.

---

## 🧱 Architecture

```
valenhart-tv/
├── server.js           ← Full Express + Socket.IO backend
├── public/
│   ├── index.html      ← App shell + all HTML
│   └── app.js          ← All frontend logic (IIFE module)
├── data/
│   ├── channels.json   ← Demo channel data
│   └── epg.json        ← Demo EPG data
└── package.json
```

---

## ⚙️ API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/channels` | GET | List channels (paged, filterable) |
| `/api/channels/search?q=` | GET | Live search |
| `/api/categories` | GET | All categories with counts |
| `/api/playlists` | GET | List loaded playlists |
| `/api/playlist/url` | POST | Load M3U from URL |
| `/api/playlist/upload` | POST | Load M3U from file content |
| `/api/playlists/:id/activate` | POST | Switch active playlist |
| `/api/playlists/:id` | DELETE | Remove playlist |
| `/api/favorites` | GET | Get favorites |
| `/api/favorites/:id` | POST/DELETE | Add/remove favorite |
| `/api/ratings/:id` | GET/POST | Get/add rating |
| `/api/epg` | GET | Program guide |
| `/api/stats` | GET | Viewer/channel stats |
| `/api/proxy/stream?url=` | GET | CORS proxy for streams |
| `/api/proxy/m3u?url=` | GET | CORS proxy for M3U files |

---

## 🎮 Features

### IPTV Core
- ✅ M3U playlist loading (URL + file upload)
- ✅ Automatic M3U parsing (name, logo, group-title, country, language)
- ✅ Multiple playlist support with switching
- ✅ Dynamic categories auto-generated from group-title
- ✅ HLS (.m3u8) playback via HLS.js
- ✅ CORS proxy for streams (bypass CORS errors)
- ✅ Error handling + auto-retry with proxy
- ✅ Paginated channel loading for large playlists

### UI/UX
- ✅ Game-style dark nexus interface
- ✅ Collapsible sidebar with animated icons
- ✅ Hero section with featured channel
- ✅ Live search with dropdown results
- ✅ Channel cards with hover effects + glow
- ✅ Category filter pills
- ✅ Recently watched (localStorage)
- ✅ Favorites system (local + Socket.IO)
- ✅ Mini player mode
- ✅ Toast notifications
- ✅ Animated particles + scanlines

### Real-Time (Socket.IO)
- ✅ Live viewer counts per channel
- ✅ Live chat per channel
- ✅ Watchlist sync
- ✅ EPG live updates

---

## 🔒 CORS / Stream Issues

If streams fail to load:
1. The app will **automatically retry using the server proxy** (`/api/proxy/stream`)
2. Or click **"TRY PROXY"** in the player error screen
3. Enable **"Use CORS Proxy"** in Settings → Playback (on by default)

---

## 📦 Dependencies

```json
{
  "express": "^4.18",
  "socket.io": "^4.7",
  "node-fetch": "^2.7",
  "cors": "^2.8",
  "http-proxy-middleware": "^2.0"
}
```

Frontend: **HLS.js** (loaded from CDN) — no build step required.

---

*VALENHART TV v3.0 — Enter the Nexus*
