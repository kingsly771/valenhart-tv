/**
 * VALENHART TV v5 — Auth Middleware
 *
 * - protect()            → verifies access token, attaches req.user
 * - adminOnly()          → role guard (admin only)
 * - signTokens()         → issues access + refresh token pair
 * - persistRefreshToken  → saves refresh token to PostgreSQL
 * - verifyRefreshToken   → verifies refresh token signature
 * - setCookies / clearCookies → httpOnly cookie helpers
 */

const jwt    = require('jsonwebtoken');
const prisma = require('../db');

const ACCESS_SECRET   = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('[Auth] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set.');
}

// ── Token Signing ────────────────────────────────────────

const signTokens = (userId) => ({
  accessToken: jwt.sign(
    { sub: userId, type: 'access' },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  ),
  refreshToken: jwt.sign(
    { sub: userId, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  ),
});

const persistRefreshToken = (userId, token) =>
  prisma.refreshToken.create({
    data: { token, userId, expiresAt: getRefreshExpiry() },
  });

function getRefreshExpiry() {
  const str  = REFRESH_EXPIRES;
  const unit = str.slice(-1);
  const val  = parseInt(str);
  const ms   = unit === 'd' ? val * 86_400_000
              : unit === 'h' ? val * 3_600_000
              : unit === 'm' ? val * 60_000
              : val * 1_000;
  return new Date(Date.now() + ms);
}

// ── Access Token Middleware ──────────────────────────────

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer '))
      token = req.headers.authorization.split(' ')[1];

    if (!token)
      return res.status(401).json({ error: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(token, ACCESS_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError')
        return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (decoded.type !== 'access')
      return res.status(401).json({ error: 'Invalid token type' });

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, username: true, role: true, avatar: true, isVerified: true },
    });

    if (!user)
      return res.status(401).json({ error: 'User no longer exists' });

    req.user = user;
    next();
  } catch (err) {
    console.error('[protect]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Role Guard ───────────────────────────────────────────

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ── Refresh Token Verification ───────────────────────────

const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, REFRESH_SECRET);
  if (decoded.type !== 'refresh') throw new Error('Invalid token type');
  return decoded;
};

// ── Cookie Helpers ───────────────────────────────────────

const REFRESH_COOKIE = 'vh_refresh';
const isProd = () => process.env.NODE_ENV === 'production';

const setCookies = (res, _access, refreshToken) => {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure:   isProd(),
    sameSite: isProd() ? 'strict' : 'lax',
    path:     '/auth/refresh',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
};

const clearCookies = (res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/auth/refresh' });
};

// ── Legacy shim: keeps routes/user.js + routes/admin.js working ─
// protect() no longer needs a store arg — Prisma handles DB lookups
const legacyProtect = (_store) => protect;

// ── Old single-token sign (kept for admin.js compatibility) ─
const signToken = (id) => signTokens(id).accessToken;

module.exports = {
  protect,
  legacyProtect,
  adminOnly,
  signToken,      // legacy single-token (admin panel uses this)
  signTokens,
  persistRefreshToken,
  verifyRefreshToken,
  setCookies,
  clearCookies,
  REFRESH_COOKIE,
};
