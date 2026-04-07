# VALENHART TV v4.0
**By Sᴜʟᴛᴀɴ✨Lᴜᴄɪᴇɴ❄️Vᴀʟᴇɴʜᴀʀᴛ亗**

Premium Live IPTV Platform with JWT auth, admin panel, and SQLite persistence.

## Features

| Feature | Description |
|---|---|
| 📺 **IPTV** | M3U playlist support (URL & file upload) |
| 🔐 **JWT Auth** | Register / Login with role-based access |
| 🛡️ **Admin Panel** | Manage users, playlists, history at `/admin-panel` |
| 🗄️ **SQLite** | Zero-config file-based database, no external server needed |
| ⭐ **Favorites** | Per-user favorites persisted to database |
| 🕐 **History** | Per-user watch history persisted to database |
| 💬 **Live Chat** | Socket.IO per-channel chat |
| 📡 **EPG** | Electronic program guide |

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env — set JWT_SECRET
node server.js
```

## Environment Variables

```
PORT=3000
JWT_SECRET=your-long-random-secret
DB_PATH=./data/valenhart.db   # optional, this is the default
```

## Deploy on Render

1. Push to GitHub
2. Create a **Web Service** on Render, connect the repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add env var: `JWT_SECRET` = any long random string
6. No database URL needed — SQLite file is created automatically

> **First user to register becomes admin automatically.**

## Project Structure

```
valenhart-tv/
├── server.js              ← Express + Socket.IO entry point
├── config/
│   └── db.js              ← SQLite connection & schema
├── middleware/
│   └── auth.js            ← JWT protect / adminOnly guards
├── routes/
│   ├── auth.js            ← /auth/register, /auth/login, /auth/me
│   ├── admin.js           ← /admin/* (admin only)
│   └── user.js            ← /api/user/favorites, /api/user/history
├── public/
│   ├── index.html         ← Main IPTV app
│   ├── app.js             ← Frontend JS
│   └── admin.html         ← Admin control panel
└── data/
    ├── channels.json      ← Demo channels
    ├── epg.json           ← Program guide
    └── valenhart.db       ← SQLite database (auto-created)
```
