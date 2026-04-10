/**
 * VALENHART TV v5 — Email Service
 * Sends verification and password-reset emails via nodemailer.
 * Works with any SMTP provider (Resend, SendGrid, Mailgun, Ethereal, etc.)
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return _transporter;
}

// ── Send verification email ───────────────────────────────

async function sendVerificationEmail(to, token) {
  const url = `${process.env.APP_URL}/auth/verify-email?token=${token}`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || 'Valenhart TV <noreply@valenhart.tv>',
    to,
    subject: '⬡ Verify your Valenhart TV account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#05070f;color:#f0f6ff;padding:32px;border-radius:12px;border:1px solid #00d4ff33">
        <h2 style="color:#00d4ff;font-size:1.4rem;margin-bottom:8px">⬡ VALENHART TV</h2>
        <p style="color:#8ba4bc;font-size:0.85rem;margin-bottom:24px">Verify your email address to activate your account.</p>
        <a href="${url}"
           style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;text-decoration:none;border-radius:6px;font-weight:700;letter-spacing:1px;font-size:0.9rem">
          VERIFY EMAIL
        </a>
        <p style="color:#4a6278;font-size:0.72rem;margin-top:20px">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border-color:#00d4ff22;margin:20px 0">
        <p style="color:#243040;font-size:0.65rem">Or copy this URL: ${url}</p>
      </div>
    `,
  });
}

// ── Send password reset email ─────────────────────────────

async function sendPasswordResetEmail(to, token) {
  const url = `${process.env.APP_URL}/reset-password?token=${token}`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || 'Valenhart TV <noreply@valenhart.tv>',
    to,
    subject: '⬡ Reset your Valenhart TV password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#05070f;color:#f0f6ff;padding:32px;border-radius:12px;border:1px solid #00d4ff33">
        <h2 style="color:#00d4ff;font-size:1.4rem;margin-bottom:8px">⬡ VALENHART TV</h2>
        <p style="color:#8ba4bc;font-size:0.85rem;margin-bottom:24px">We received a request to reset your password.</p>
        <a href="${url}"
           style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;text-decoration:none;border-radius:6px;font-weight:700;letter-spacing:1px;font-size:0.9rem">
          RESET PASSWORD
        </a>
        <p style="color:#4a6278;font-size:0.72rem;margin-top:20px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
        <hr style="border-color:#00d4ff22;margin:20px 0">
        <p style="color:#243040;font-size:0.65rem">Or copy this URL: ${url}</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
