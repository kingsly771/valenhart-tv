/**
 * VALENHART TV v5 — Auth Routes (PostgreSQL + Prisma)
 *
 * POST   /auth/register          Register new user
 * POST   /auth/login             Login → access + refresh tokens
 * POST   /auth/refresh           Rotate refresh token → new access token
 * POST   /auth/logout            Invalidate refresh token
 * GET    /auth/me                Get current user (access token required)
 * GET    /auth/verify-email      Verify email address via token
 * POST   /auth/forgot-password   Send password reset email
 * POST   /auth/reset-password    Reset password with token
 */

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');

const prisma   = require('../db');
const {
  protect,
  signTokens,
  persistRefreshToken,
  verifyRefreshToken,
  setCookies,
  clearCookies,
  REFRESH_COOKIE,
} = require('../middleware/auth');

const {
  validate,
  registerRules,
  loginRules,
  forgotPasswordRules,
  resetPasswordRules,
} = require('../src/validators/auth.validators');

const {
  authLimiter,
  refreshLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimiter');

const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email.service');

const AVATARS = ['🎬','⚽','🎵','🌍','🚀','🎭','📡','🏀','🎞','🌿','🔥','⚡','🎯','🏆','🎪'];
const safeUser = ({ password, ...u }) => u;

// ══════════════════════════════════════════════════════════
//  POST /auth/register
// ══════════════════════════════════════════════════════════
router.post('/register', authLimiter, registerRules, validate, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check duplicates
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true, username: true },
    });

    if (existing) {
      const field = existing.email === email ? 'email' : 'username';
      return res.status(409).json({ error: `That ${field} is already taken` });
    }

    // First-ever user becomes admin
    const userCount = await prisma.user.count();
    const role      = userCount === 0 ? 'admin' : 'user';

    const hashed = await bcrypt.hash(password, 12);
    const emailVerifyToken  = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await prisma.user.create({
      data: {
        id:       uuidv4(),
        username,
        email,
        password: hashed,
        role,
        avatar:   AVATARS[Math.floor(Math.random() * AVATARS.length)],
        // Store verification token in passwordResets table (reuse schema)
        passwordResets: {
          create: {
            token:     emailVerifyToken,
            expiresAt: emailVerifyExpiry,
          },
        },
      },
    });

    // Issue tokens
    const { accessToken, refreshToken } = signTokens(user.id);
    await persistRefreshToken(user.id, refreshToken);
    setCookies(res, accessToken, refreshToken);

    // Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(email, emailVerifyToken).catch(err =>
      console.warn('[email] Failed to send verification email:', err.message)
    );

    res.status(201).json({
      accessToken,
      user: safeUser(user),
      message: 'Account created. Check your email to verify your address.',
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /auth/login
// ══════════════════════════════════════════════════════════
router.post('/login', authLimiter, loginRules, validate, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Timing-safe: always run bcrypt even on missing user to prevent timing attacks
    const dummyHash = '$2a$12$invalidhashfortimingnullcomparison000000000000000000000';
    const isValid   = await bcrypt.compare(password, user?.password || dummyHash);

    if (!user || !isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Revoke all old refresh tokens for this user (single-session policy)
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    // Issue new token pair
    const { accessToken, refreshToken } = signTokens(user.id);
    await persistRefreshToken(user.id, refreshToken);
    setCookies(res, accessToken, refreshToken);

    // Update lastSeen
    await prisma.user.update({
      where: { id: user.id },
      data:  { lastSeen: new Date() },
    });

    res.json({ accessToken, user: safeUser(user) });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /auth/refresh
//  Reads refresh token from httpOnly cookie OR request body.
//  Rotates token: old token is deleted, new pair issued.
// ══════════════════════════════════════════════════════════
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    // Accept cookie (preferred) or body (for mobile clients)
    const incomingToken = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

    if (!incomingToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    // Verify signature
    let decoded;
    try {
      decoded = verifyRefreshToken(incomingToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Find token in DB (token rotation: it must still exist)
    const stored = await prisma.refreshToken.findUnique({
      where: { token: incomingToken },
    });

    if (!stored) {
      // Token reuse detected → revoke ALL tokens for this user (compromise response)
      await prisma.refreshToken.deleteMany({ where: { userId: decoded.sub } });
      clearCookies(res);
      return res.status(401).json({ error: 'Refresh token reuse detected. Please log in again.' });
    }

    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      clearCookies(res);
      return res.status(401).json({ error: 'Refresh token expired. Please log in again.' });
    }

    // Confirm user still exists
    const user = await prisma.user.findUnique({
      where:  { id: stored.userId },
      select: { id: true, email: true, username: true, role: true, avatar: true, isVerified: true },
    });

    if (!user) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      clearCookies(res);
      return res.status(401).json({ error: 'User not found' });
    }

    // Rotate: delete old, issue new
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    const { accessToken, refreshToken: newRefresh } = signTokens(user.id);
    await persistRefreshToken(user.id, newRefresh);
    setCookies(res, accessToken, newRefresh);

    res.json({ accessToken, user });
  } catch (err) {
    console.error('[refresh]', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /auth/logout
// ══════════════════════════════════════════════════════════
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } });
    }

    clearCookies(res);
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('[logout]', err);
    // Always clear cookies and return success — don't leak errors
    clearCookies(res);
    res.json({ ok: true });
  }
});

// ══════════════════════════════════════════════════════════
//  GET /auth/me
// ══════════════════════════════════════════════════════════
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// ══════════════════════════════════════════════════════════
//  GET /auth/verify-email?token=...
// ══════════════════════════════════════════════════════════
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const record = await prisma.passwordReset.findUnique({ where: { token } });

    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Verification link is invalid or has expired' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data:  { isVerified: true },
      }),
      prisma.passwordReset.update({
        where: { id: record.id },
        data:  { used: true },
      }),
    ]);

    // Redirect to frontend (or return JSON for API clients)
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    res.redirect(`${appUrl}/?verified=true`);
  } catch (err) {
    console.error('[verify-email]', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /auth/forgot-password
// ══════════════════════════════════════════════════════════
router.post('/forgot-password', passwordResetLimiter, forgotPasswordRules, validate, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond with success to prevent email enumeration
    const SUCCESS = { ok: true, message: 'If that email exists, a reset link has been sent.' };

    if (!user) return res.json(SUCCESS);

    // Delete any existing reset tokens for this user
    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordReset.create({
      data: { token, userId: user.id, expiresAt: expires },
    });

    await sendPasswordResetEmail(email, token);

    res.json(SUCCESS);
  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /auth/reset-password
// ══════════════════════════════════════════════════════════
router.post('/reset-password', resetPasswordRules, validate, async (req, res) => {
  try {
    const { token, password } = req.body;

    const record = await prisma.passwordReset.findUnique({ where: { token } });

    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    const hashed = await bcrypt.hash(password, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data:  { password: hashed },
      }),
      prisma.passwordReset.update({
        where: { id: record.id },
        data:  { used: true },
      }),
      // Revoke all refresh tokens after password change
      prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    clearCookies(res);
    res.json({ ok: true, message: 'Password updated. Please log in again.' });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;
