/**
 * VALENHART TV — Auth Routes (SQLite-backed via db.js)
 */
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { signToken } = require('../middleware/auth');

const getStore = (req) => req.app.locals.authStore;

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    const store = getStore(req);
    const byEmail    = store.findUserByEmail(email);
    const byUsername = store.findUserByUsername(username);
    if (byEmail || byUsername)
      return res.status(409).json({ error: 'Username or email already taken' });

    const role   = store.countUsers() === 0 ? 'admin' : 'user';
    const hashed = await bcrypt.hash(password, 12);
    const AVATARS = ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆','🎪'];
    const user = {
      id:        String(Date.now()),
      username,
      email,
      password:  hashed,
      role,
      avatar:    AVATARS[Math.floor(Math.random() * AVATARS.length)],
      createdAt: new Date().toISOString(),
      lastSeen:  new Date().toISOString(),
    };
    store.insertUser(user);

    const { password: _, ...safe } = user;
    const token = signToken(user.id);
    res.status(201).json({ token, user: safe });
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

    const store = getStore(req);
    const user  = store.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    store.updateUserLastSeen(user.id, new Date().toISOString());
    const { password: _, ...safe } = user;
    const token = signToken(user.id);
    res.json({ token, user: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get('/me', (req, res) => {
  const store = getStore(req);
  let token;
  if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const jwt     = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'valenhart-tv-super-secret-key-2024');
    const user    = store.findUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const { password: _, ...safe } = user;
    res.json({ user: safe });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/logout', (req, res) => res.json({ ok: true }));

module.exports = router;
