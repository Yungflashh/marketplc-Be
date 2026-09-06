// In-memory counter for failed logins, OTP misses, and OTP resends.
// Keyed by "type:identifier" (e.g. "login:jane@x.com", "otp:1.2.3.4").
// Entries auto-expire after WINDOW_MS of inactivity.

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const store = new Map();

const now = () => Date.now();

const purge = () => {
  const t = now();
  for (const [k, v] of store) {
    if (v.expiresAt <= t) store.delete(k);
  }
};

// Bump the counter and return the current count. Rolling window: each bump extends expiry.
const bump = (type, identifier) => {
  if (!identifier) return 0;
  purge();
  const key = `${type}:${identifier}`;
  const entry = store.get(key) || { count: 0, expiresAt: 0 };
  entry.count += 1;
  entry.expiresAt = now() + WINDOW_MS;
  store.set(key, entry);
  return entry.count;
};

const peek = (type, identifier) => {
  if (!identifier) return 0;
  const entry = store.get(`${type}:${identifier}`);
  if (!entry || entry.expiresAt <= now()) return 0;
  return entry.count;
};

const reset = (type, identifier) => {
  if (!identifier) return;
  store.delete(`${type}:${identifier}`);
};

module.exports = { bump, peek, reset, WINDOW_MS };
