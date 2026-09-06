// Rate limiters for auth-sensitive endpoints. Trips fire a Telegram alert.
const rateLimit = require('express-rate-limit');
const { notify, escapeHtml } = require('../utils/telegram');
const { extract, renderBlock } = require('../utils/requestContext');

// Track first-trip vs repeat trips per key so we don't spam Telegram on every
// blocked request after the limit is already hit.
const notifiedKeys = new Map();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

const shouldNotify = (key) => {
  const last = notifiedKeys.get(key) || 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) return false;
  notifiedKeys.set(key, Date.now());
  return true;
};

// Build a limiter that pings Telegram on trip.
const buildLimiter = ({ label, windowMs, max }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      const ctx = extract(req);
      const key = `${label}:${ctx.ip}`;
      if (shouldNotify(key)) {
        notify(
          `⏱️ <b>Rate limit tripped</b>\n` +
            `Endpoint: <code>${escapeHtml(label)}</code>\n` +
            `Path: <code>${escapeHtml(req.originalUrl || req.url || '')}</code>\n` +
            `Limit: ${max} / ${Math.round(windowMs / 60000)} min\n\n` +
            renderBlock(ctx),
          { severity: 'alert' }
        );
      }
      res.status(options.statusCode).json({
        success: false,
        message: options.message || 'Too many requests, please slow down.',
      });
    },
  });

// Public: auth-heavy endpoints (login / register / password reset)
exports.authLimiter = buildLimiter({
  label: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 20,
});

// Public: OTP resend — tighter cap
exports.otpLimiter = buildLimiter({
  label: 'otp',
  windowMs: 15 * 60 * 1000,
  max: 8,
});

// Public: support / track — moderate
exports.publicLimiter = buildLimiter({
  label: 'public',
  windowMs: 60 * 1000,
  max: 60,
});
