const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const { signToken, protect } = require('../middleware/auth');

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields required' });

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(409).json({ error: 'Username or email already taken' });

    // First ever user becomes admin
    const count = await User.countDocuments();
    const role  = count === 0 ? 'admin' : 'user';

    const user  = await User.create({ username, email, password, role });
    const token = signToken(user._id);

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

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid credentials' });

    await User.findByIdAndUpdate(user._id, { lastSeen: new Date() });

    const token = signToken(user._id);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me — current user
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// POST /auth/logout (client-side — just for completeness)
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
