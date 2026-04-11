# ⬡ VALENHART TV v5.0

Premium IPTV platform — now with PostgreSQL + production-grade auth.

---

## What's new in v5

| Feature | v4 (old) | v5 (new) |
|---|---|---|
| Database | SQLite (better-sqlite3) | PostgreSQL via Prisma |
| Auth tokens | Single JWT (7d) | Access token (15m) + Refresh token (7d, rotated) |
| Token storage | localStorage | Access: memory only · Refresh: httpOnly cookie |
| Password hashing | bcrypt (12 rounds) | bcrypt (12 rounds) ✓ |
| Input validation | None | express-validator on all auth inputs |
| Rate limiting | None | Per-route limiters (auth: 10/15min, reset: 5/hr) |
| Security headers | None | helmet |
| Token rotation | No | Yes (refresh token invalidated on each use) |
| Password reset | No | Yes (email link, 1hr expiry) |
| Email verification | No | Yes (24hr expiry) |
| Brute-force protection | No | Yes (rate limiting + timing-safe compare) |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env — set DATABASE_URL and generate JWT secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Create the database
```bash
# Run migrations (creates all tables)
npm run db:migrate

# Or for production deploy:
npm run db:deploy
```

### 4. Start the server
```bash
npm run dev     # development (nodemon)
npm start       # production
```

---

## Auth API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register (username, email, password) |
| POST | `/auth/login` | Login → access token + httpOnly refresh cookie |
| POST | `/auth/refresh` | Rotate refresh token → new access token |
| POST | `/auth/logout` | Invalidate refresh token, clear cookie |
| GET  | `/auth/me` | Get current user (Bearer token required) |
| GET  | `/auth/verify-email?token=` | Verify email address |
| POST | `/auth/forgot-password` | Send password reset email |
| POST | `/auth/reset-password` | Set new password with reset token |

### Password requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one number

---

## Database schema

```
users              — id (UUID), email, username, password (hashed), role, isVerified
refresh_tokens     — id, userId (FK), token (unique), expiresAt
password_resets    — id, userId (FK), token (unique), expiresAt, used
favorites          — id, userId (FK), channelId (unique per user)
watch_history      — id, userId (FK), channelId, watchedAt
playlists          — id, name, url, channelCount, categories, isActive
```

---

## Deploy on Render

1. Create a **PostgreSQL** service on Render
2. Copy the **External Database URL** into your env as `DATABASE_URL`
3. Add all other env vars from `.env.example`
4. Set build command: `npm install && npm run db:deploy && npm run db:generate`
5. Set start command: `npm start`

---

## Security notes

- Access tokens live **in memory only** — never written to localStorage or cookies
- Refresh tokens are stored in **httpOnly + secure + sameSite** cookies scoped to `/auth/refresh`
- On refresh token reuse (stolen token replay), **all tokens for that user are immediately revoked**
- All auth inputs are validated and sanitized server-side via express-validator
- Generic error messages on login failure (no email enumeration)
- Timing-safe bcrypt compare even for non-existent users
- Password resets revoke all active refresh tokens
