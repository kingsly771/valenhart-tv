const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { getDB } = require('../config/db');
const { signToken, protect } = require('../middleware/auth');

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db = getDB();

    const existing = db.prepare('SELECT id FROM users WHERE email=? OR username=?').get(email.toLowerCase(), username);
    if (existing) return res.status(409).json({ error: 'Username or email already taken' });

    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const role  = count === 0 ? 'admin' : 'user';

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)'
    ).run(username, email.toLowerCase(), hash, role);

    const user  = db.prepare('SELECT id,username,email,role,avatar,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
    const token = signToken(user.id);

    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const db   = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    db.prepare("UPDATE users SET last_seen=datetime('now') WHERE id=?").run(user.id);

    const token  = signToken(user.id);
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
