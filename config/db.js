/**
 * VALENHART TV — SQLite Database
 * Zero-config, file-based, works everywhere including Render free tier.
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'valenhart.db');

let db;

function getDB() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

function connectDB() {
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT    NOT NULL UNIQUE,
        email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password   TEXT    NOT NULL,
        role       TEXT    NOT NULL DEFAULT 'user',
        avatar     TEXT    NOT NULL DEFAULT '🎭',
        is_active  INTEGER NOT NULL DEFAULT 1,
        last_seen  TEXT    DEFAULT (datetime('now')),
        created_at TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        url           TEXT,
        channel_count INTEGER DEFAULT 0,
        categories    TEXT    DEFAULT '[]',
        is_active     INTEGER DEFAULT 0,
        added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at    TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id   TEXT    NOT NULL,
        channel_name TEXT,
        stream_url   TEXT,
        logo         TEXT,
        grp          TEXT,
        added_at     TEXT    DEFAULT (datetime('now')),
        UNIQUE(user_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id   TEXT    NOT NULL,
        channel_name TEXT,
        stream_url   TEXT,
        logo         TEXT,
        grp          TEXT,
        watched_at   TEXT    DEFAULT (datetime('now'))
      );
    `);

    console.log('  🗄️  SQLite ready:', DB_PATH);
  } catch (err) {
    console.error('  ✖  SQLite init failed:', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB, getDB };
