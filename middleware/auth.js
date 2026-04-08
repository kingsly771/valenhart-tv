/**
 * VALENHART TV — Auth Middleware (JWT, SQLite-backed)
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'valenhart-tv-super-secret-key-2026';

/**
 * Verify JWT — attaches req.user from store
 * store can be the dbStore object (has findUserById) or legacy array-based store
 */
const protect = (store) => (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Support both new dbStore API and legacy array-based store
    const user = typeof store.findUserById === 'function'
      ? store.findUserById(decoded.id)
      : (store.users || []).find(u => u.id === decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

const signToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' });

module.exports = { protect, adminOnly, signToken };
