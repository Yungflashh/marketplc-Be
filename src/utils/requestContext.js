// Request-context helper: pulls IP, geo, device, and UTM/referrer info
// from an Express req and produces a formatted HTML block for Telegram.

const geoip = require('geoip-lite');
const { UAParser } = require('ua-parser-js');
const crypto = require('crypto');
const { escapeHtml } = require('./telegram');

const getIp = (req) => {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown';
};

const lookupGeo = (ip) => {
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip === '::1') return null;
  try {
    const clean = ip.replace(/^::ffff:/, '');
    return geoip.lookup(clean);
  } catch {
    return null;
  }
};

const parseUa = (uaString) => {
  if (!uaString) return null;
  try {
    const parser = new UAParser(uaString);
    const r = parser.getResult();
    const browser = [r.browser?.name, r.browser?.version].filter(Boolean).join(' ');
    const os = [r.os?.name, r.os?.version].filter(Boolean).join(' ');
    const device = r.device?.type ? `${r.device?.vendor || ''} ${r.device?.model || ''}`.trim() : 'desktop';
    return { browser: browser || null, os: os || null, device: device || null };
  } catch {
    return null;
  }
};

const parseUtm = (referrer, bodyOrQuery = {}) => {
  const out = {};
  const url = referrer ? tryUrl(referrer) : null;
  const src = bodyOrQuery.utm_source || url?.searchParams.get('utm_source');
  const med = bodyOrQuery.utm_medium || url?.searchParams.get('utm_medium');
  const cmp = bodyOrQuery.utm_campaign || url?.searchParams.get('utm_campaign');
  if (src) out.source = src;
  if (med) out.medium = med;
  if (cmp) out.campaign = cmp;
  return Object.keys(out).length ? out : null;
};

const tryUrl = (s) => {
  try { return new URL(s); } catch { return null; }
};

// Stable hash of UA+IP used for "known device" detection.
const deviceFingerprint = (req) => {
  const ua = req?.headers?.['user-agent'] || '';
  const ip = getIp(req);
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
};

// Extract everything at once — for callers that want a bundle.
const extract = (req) => {
  const ip = getIp(req);
  const ua = req?.headers?.['user-agent'] || '';
  const referrer = req?.headers?.referer || req?.headers?.referrer || req?.body?.referrer || '';
  const geo = lookupGeo(ip);
  const device = parseUa(ua);
  const utm = parseUtm(referrer, { ...(req?.body || {}), ...(req?.query || {}) });
  return {
    ip,
    ua,
    referrer,
    geo,
    device,
    utm,
    fingerprint: deviceFingerprint(req),
    timezone: geo?.timezone || null,
  };
};

// Render an HTML block for a Telegram message. Skips empty sections.
const renderBlock = (ctx) => {
  const lines = [];
  if (ctx.ip) lines.push(`IP: <code>${escapeHtml(ctx.ip)}</code>`);
  if (ctx.geo) {
    const parts = [ctx.geo.city, ctx.geo.region, ctx.geo.country].filter(Boolean);
    if (parts.length) lines.push(`📍 ${escapeHtml(parts.join(', '))}${ctx.geo.timezone ? ` (${escapeHtml(ctx.geo.timezone)})` : ''}`);
  }
  if (ctx.device) {
    const bits = [ctx.device.browser, ctx.device.os, ctx.device.device].filter((b) => b && b !== 'desktop');
    bits.push(ctx.device.device === 'desktop' ? '🖥️ desktop' : '📱 mobile');
    lines.push(`🧭 ${escapeHtml(bits.join(' · '))}`);
  }
  if (ctx.referrer) lines.push(`Ref: ${escapeHtml(ctx.referrer.slice(0, 120))}`);
  if (ctx.utm) {
    const utmStr = Object.entries(ctx.utm).map(([k, v]) => `${k}=${v}`).join(' · ');
    lines.push(`🎯 UTM: ${escapeHtml(utmStr)}`);
  }
  return lines.join('\n');
};

// Convenience: extract + render in one call.
const contextBlock = (req) => renderBlock(extract(req));

module.exports = {
  getIp,
  lookupGeo,
  parseUa,
  parseUtm,
  deviceFingerprint,
  extract,
  renderBlock,
  contextBlock,
};
