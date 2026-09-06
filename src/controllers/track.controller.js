const { notify, escapeHtml } = require('../utils/telegram');

// 60-second per-IP dedupe. In-memory Map (single-instance).
// For multi-instance deploys, swap for Redis.
const DEDUPE_WINDOW_MS = 60 * 1000;
const recentIps = new Map();

const gc = () => {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  for (const [ip, ts] of recentIps) {
    if (ts < cutoff) recentIps.delete(ip);
  }
};
setInterval(gc, 60 * 1000).unref?.();

exports.visit = (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0].trim())
      || req.socket?.remoteAddress
      || 'unknown';

    const now = Date.now();
    const last = recentIps.get(ip);
    if (last && now - last < DEDUPE_WINDOW_MS) {
      return res.json({ success: true, deduped: true });
    }
    recentIps.set(ip, now);

    const ua = String(req.headers['user-agent'] || 'unknown').slice(0, 240);
    const referrer = String(req.body?.referrer || req.headers.referer || '').slice(0, 240);
    const path = String(req.body?.path || '').slice(0, 240);

    notify(
      `👀 <b>Visitor</b>\nIP: <code>${escapeHtml(ip)}</code>\nUA: ${escapeHtml(ua)}${
        path ? `\nPath: ${escapeHtml(path)}` : ''
      }${referrer ? `\nRef: ${escapeHtml(referrer)}` : ''}`
    );

    res.json({ success: true, deduped: false });
  } catch (error) {
    // Never fail the request — tracking is best-effort.
    console.warn('track.visit error:', error.message);
    res.json({ success: true });
  }
};
