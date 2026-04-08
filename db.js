/**
 * VALENHART TV — SQLite Persistence Layer
 * Uses better-sqlite3 (synchronous, Render-compatible)
 * Falls back to in-memory if SQLite is unavailable.
 */

let db = null;

try {
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'valenhart.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');   // Better concurrent read performance
  db.pragma('foreign_keys = ON');

  // ── Users ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      avatar     TEXT DEFAULT '🎭',
      createdAt  TEXT NOT NULL,
      lastSeen   TEXT NOT NULL
    );
  `);

  // ── Playlists metadata ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      _id          TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      url          TEXT,
      channelCount INTEGER DEFAULT 0,
      categories   TEXT DEFAULT '[]',
      isActive     INTEGER DEFAULT 1,
      addedById    TEXT,
      createdAt    TEXT NOT NULL
    );
  `);

  // ── Favorites ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      channelId   TEXT NOT NULL,
      channelName TEXT,
      streamUrl   TEXT,
      logo        TEXT,
      grp         TEXT,
      addedAt     TEXT NOT NULL,
      UNIQUE(userId, channelId)
    );
  `);

  // ── History ────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      channelId   TEXT NOT NULL,
      channelName TEXT,
      streamUrl   TEXT,
      logo        TEXT,
      grp         TEXT,
      watchedAt   TEXT NOT NULL
    );
  `);

  console.log('  💾 SQLite storage active:', dbPath);
} catch (err) {
  console.warn('  ⚠️  SQLite unavailable — using in-memory store:', err.message);
  db = null;
}

// ── Helper: convert DB row → JS object (grp → group) ──────
function fixRow(row) {
  if (!row) return null;
  if (row.grp !== undefined) { row.group = row.grp; delete row.grp; }
  if (row.isActive !== undefined) row.isActive = !!row.isActive;
  if (row.categories && typeof row.categories === 'string') {
    try { row.categories = JSON.parse(row.categories); } catch { row.categories = []; }
  }
  return row;
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC API  (mirrors in-memory authStore shape)
// ═══════════════════════════════════════════════════════════

const store = {
  // ── USERS ────────────────────────────────────────────────
  getUsers() {
    if (!db) return this._mem.users;
    return db.prepare('SELECT * FROM users').all();
  },
  findUserByEmail(email) {
    if (!db) return this._mem.users.find(u => u.email === email) || null;
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
  },
  findUserByUsername(username) {
    if (!db) return this._mem.users.find(u => u.username === username) || null;
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  },
  findUserById(id) {
    if (!db) return this._mem.users.find(u => u.id === id) || null;
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  },
  insertUser(user) {
    if (!db) { this._mem.users.push(user); return; }
    db.prepare(`
      INSERT INTO users (id,username,email,password,role,avatar,createdAt,lastSeen)
      VALUES (@id,@username,@email,@password,@role,@avatar,@createdAt,@lastSeen)
    `).run(user);
  },
  updateUserLastSeen(id, ts) {
    if (!db) {
      const u = this._mem.users.find(u => u.id === id);
      if (u) u.lastSeen = ts;
      return;
    }
    db.prepare('UPDATE users SET lastSeen=? WHERE id=?').run(ts, id);
  },
  countUsers() {
    if (!db) return this._mem.users.length;
    return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  },
  recentUsers(n = 5) {
    if (!db) return [...this._mem.users].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,n);
    return db.prepare('SELECT * FROM users ORDER BY createdAt DESC LIMIT ?').all(n);
  },

  // ── PLAYLISTS ────────────────────────────────────────────
  getPlaylists() {
    if (!db) return this._mem.playlists;
    return db.prepare('SELECT * FROM playlists').all().map(fixRow);
  },
  insertPlaylist(pl) {
    if (!db) { this._mem.playlists.push(pl); return; }
    db.prepare(`
      INSERT OR REPLACE INTO playlists (_id,name,url,channelCount,categories,isActive,addedById,createdAt)
      VALUES (@_id,@name,@url,@channelCount,@categories,@isActive,@addedById,@createdAt)
    `).run({ ...pl, categories: JSON.stringify(pl.categories||[]), isActive: pl.isActive ? 1 : 0 });
  },
  deletePlaylist(id) {
    if (!db) { this._mem.playlists = this._mem.playlists.filter(p=>p._id!==id); return; }
    db.prepare('DELETE FROM playlists WHERE _id=?').run(id);
  },
  countPlaylists() {
    if (!db) return this._mem.playlists.length;
    return db.prepare('SELECT COUNT(*) as n FROM playlists').get().n;
  },

  // ── FAVORITES ────────────────────────────────────────────
  getFavorites() {
    if (!db) return this._mem.favorites;
    return db.prepare('SELECT * FROM favorites').all().map(fixRow);
  },
  getFavoritesByUser(userId) {
    if (!db) return this._mem.favorites.filter(f=>f.userId===userId);
    return db.prepare('SELECT * FROM favorites WHERE userId=? ORDER BY addedAt DESC').all(userId).map(fixRow);
  },
  insertFavorite(fav) {
    if (!db) {
      if (!this._mem.favorites.find(f=>f.userId===fav.userId&&f.channelId===fav.channelId))
        this._mem.favorites.push(fav);
      return;
    }
    db.prepare(`
      INSERT OR IGNORE INTO favorites (id,userId,channelId,channelName,streamUrl,logo,grp,addedAt)
      VALUES (@id,@userId,@channelId,@channelName,@streamUrl,@logo,@group,@addedAt)
    `).run(fav);
  },
  deleteFavorite(userId, channelId) {
    if (!db) {
      this._mem.favorites = this._mem.favorites.filter(f=>!(f.userId===userId&&f.channelId===channelId));
      return;
    }
    db.prepare('DELETE FROM favorites WHERE userId=? AND channelId=?').run(userId, channelId);
  },
  countFavorites() {
    if (!db) return this._mem.favorites.length;
    return db.prepare('SELECT COUNT(*) as n FROM favorites').get().n;
  },

  // ── HISTORY ──────────────────────────────────────────────
  getHistory() {
    if (!db) return this._mem.history;
    return db.prepare('SELECT * FROM history').all().map(fixRow);
  },
  getHistoryByUser(userId, limit=50) {
    if (!db) return this._mem.history.filter(h=>h.userId===userId).slice(-limit);
    return db.prepare('SELECT * FROM history WHERE userId=? ORDER BY watchedAt DESC LIMIT ?').all(userId,limit).map(fixRow);
  },
  insertHistory(entry) {
    if (!db) { this._mem.history.push(entry); return; }
    db.prepare(`
      INSERT INTO history (id,userId,channelId,channelName,streamUrl,logo,grp,watchedAt)
      VALUES (@id,@userId,@channelId,@channelName,@streamUrl,@logo,@group,@watchedAt)
    `).run(entry);
  },
  recentHistory(n=10) {
    if (!db) return [...this._mem.history].sort((a,b)=>new Date(b.watchedAt)-new Date(a.watchedAt)).slice(0,n);
    return db.prepare('SELECT * FROM history ORDER BY watchedAt DESC LIMIT ?').all(n).map(fixRow);
  },
  countHistory() {
    if (!db) return this._mem.history.length;
    return db.prepare('SELECT COUNT(*) as n FROM history').get().n;
  },

  // ── EXTRA ADMIN HELPERS ───────────────────────────────────
  _db_deleteUser(id) {
    if (!db) { this._mem.users = this._mem.users.filter(u => u.id !== id); return; }
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  },
  _db_updateUserRole(id, role) {
    if (!db) {
      const u = this._mem.users.find(u => u.id === id);
      if (u) u.role = role;
      return;
    }
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  },
  _db_deleteUserHistory(userId) {
    if (!db) { this._mem.history = this._mem.history.filter(h => h.userId !== userId); return; }
    db.prepare('DELETE FROM history WHERE userId=?').run(userId);
  },

  // ── IN-MEMORY FALLBACK ────────────────────────────────────
  _mem: {
    users:     [],
    playlists: [],
    favorites: [],
    history:   [],
  },
};

module.exports = { store, db };
