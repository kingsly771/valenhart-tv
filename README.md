# ⬡ VALENHART TV v4.0
### Full IPTV Platform + Admin Control Center
*By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗*

---

## 🆕 What's New in v4

| Feature | Details |
|---|---|
| 🍃 **MongoDB** | Full persistence via Mongoose |
| 🔐 **JWT Auth** | Register / Login / Role-based access |
| 🛡️ **Admin Panel** | `/admin-panel` — full dashboard UI |
| 👥 **User Management** | View, delete, promote users |
| 📡 **Playlist Control** | Add/delete M3U playlists via admin |
| ⭐ **DB Favorites** | Per-user favorites persisted to MongoDB |
| 🕐 **DB History** | Per-user watch history persisted to MongoDB |
| ✅ **v3 Compatible** | All existing IPTV features unchanged |

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — set MONGO_URI and JWT_SECRET
```

### 3. Start the server
```bash
npm start        # production
npm run dev      # with nodemon (auto-restart)
```

### 4. Open the app
- 📺 **IPTV App:** `http://localhost:3000`
- 🛡️ **Admin Panel:** `http://localhost:3000/admin-panel`

---

## 🔐 First Admin Account

The **very first user to register** automatically becomes `admin`.

Go to `/admin-panel` → click "Register here" → fill in details → you're in.

All subsequent registrations default to `user` role.

---

## 📁 Project Structure

```
valenhart-tv/
├── server.js              ← Main server (v3 + v4 merged)
├── package.json
├── .env.example
│
├── config/
│   └── db.js              ← MongoDB connection
│
├── models/
│   ├── User.js            ← username, email, password, role
│   ├── Playlist.js        ← name, url, channelCount, categories
│   ├── Favorite.js        ← userId, channelName, streamUrl
│   └── History.js         ← userId, channelName, watchedAt
│
├── middleware/
│   └── auth.js            ← protect, adminOnly, signToken
│
├── routes/
│   ├── auth.js            ← POST /auth/register, /auth/login, GET /auth/me
│   ├── admin.js           ← All /admin/* routes (admin-only)
│   └── user.js            ← /api/user/favorites, /api/user/history
│
├── data/
│   ├── channels.json      ← Demo channels fallback
│   └── epg.json           ← EPG data
│
└── public/
    ├── index.html         ← Main IPTV app (unchanged)
    ├── app.js             ← IPTV frontend (unchanged)
    └── admin.html         ← Admin Panel SPA
```

---

## 🔌 API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login, returns JWT |
| GET | `/auth/me` | Get current user |

### Admin (require `Authorization: Bearer <token>` + admin role)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/stats` | Dashboard stats |
| GET | `/admin/playlists` | List all playlists |
| POST | `/admin/playlists` | Add playlist (URL or content) |
| DELETE | `/admin/playlists/:id` | Delete playlist |
| PUT | `/admin/playlists/:id/activate` | Activate playlist |
| GET | `/admin/users` | List users (paginated) |
| DELETE | `/admin/users/:id` | Delete user |
| PUT | `/admin/users/:id/role` | Change user role |
| GET | `/admin/favorites` | All favorites (global) |
| GET | `/admin/history` | All watch history (global) |
| GET | `/admin/channels` | Active channel list |

### User (require auth token)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/user/favorites` | My favorites |
| POST | `/api/user/favorites` | Add favorite |
| DELETE | `/api/user/favorites/:channelId` | Remove favorite |
| GET | `/api/user/history` | My watch history |
| POST | `/api/user/history` | Log watched channel |
| DELETE | `/api/user/history` | Clear my history |

### IPTV (v3 — unchanged)
All `/api/channels`, `/api/playlists`, `/api/proxy/*`, `/api/stats`, `/api/epg` routes work exactly as before.

---

## 🌐 Deploying on Render

1. Add environment variables in Render dashboard:
   - `MONGO_URI` → your MongoDB Atlas connection string
   - `JWT_SECRET` → a long random string
   - `PORT` → `3000` (or let Render set it)

2. Build command: `npm install`
3. Start command: `npm start`

---

## 🔗 Frontend Integration (for logged-in users)

To persist favorites/history per-user, send the JWT token in requests:

```javascript
// Login
const { token, user } = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
}).then(r => r.json());

localStorage.setItem('vh_token', token);

// Add favorite (authenticated)
await fetch('/api/user/favorites', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('vh_token')}`
  },
  body: JSON.stringify({ channelId, channelName, streamUrl, logo, group })
});

// Log history
await fetch('/api/user/history', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ channelId, channelName, streamUrl, group })
});
```

Unauthenticated users continue to use the v3 socket-based session favorites (backward compatible).

---

*VALENHART TV v4.0 — Built with ❤️ by Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗*
