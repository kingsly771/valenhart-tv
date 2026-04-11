/**
 * VALENHART TV v5 — Rate Limiters
 * Brute-force protection on all auth endpoints.
 */

const rateLimit = require('express-rate-limit');

// ── Shared JSON error handler ─────────────────────────────
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    error: 'Too many requests. Please try again later.',
    retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
  });
};

// ── Login / Register — strict: 10 attempts per 15 min ────
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,   // 15 minutes
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  handler:          rateLimitHandler,
  skipSuccessfulRequests: true,        // only count failures
});

// ── Refresh token — moderate: 30 per 15 min ──────────────
const refreshLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

// ── Password reset email — very strict: 5 per hour ───────
const passwordResetLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,    // 1 hour
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

// ── General API — loose: 200 per 15 min ──────────────────
const apiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

module.exports = {
  authLimiter,
  refreshLimiter,
  passwordResetLimiter,
  apiLimiter,
};
