// Fire-and-forget Telegram notifier. NEVER throws.
// Silent no-op when env vars are missing so dev keeps working.

const TELEGRAM_API = 'https://api.telegram.org';

const isConfigured = () =>
  !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;

// Escape text for Telegram HTML parse mode
const escapeHtml = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Format a Date (or now) as "YYYY-MM-DD HH:MM:SS UTC" for the footer.
const formatTimestamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const SEVERITY_TAGS = {
  info: '',
  warn: '⚠️ <b>[WARN]</b>\n',
  alert: '🚨 <b>[ALERT]</b>\n',
};

// Append a timestamp footer and optional severity tag to any message.
const decorate = (message, { severity = 'info', timestamp = true } = {}) => {
  const tag = SEVERITY_TAGS[severity] || '';
  const footer = timestamp ? `\n\n<i>🕐 ${formatTimestamp()}</i>` : '';
  return `${tag}${message}${footer}`;
};

const post = async (method, body) => {
  const url = `${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method} error: ${data.description || res.status}`);
  }
  return data.result;
};

// Build a Telegram inline_keyboard from an array of { text, url } (or nested rows).
const buildKeyboard = (buttons) => {
  if (!buttons || !buttons.length) return undefined;
  const rows = Array.isArray(buttons[0]) ? buttons : [buttons];
  return { inline_keyboard: rows };
};

// Fire-and-forget notification to the admin chat. Never throws.
// opts: { severity: 'info'|'warn'|'alert', timestamp: bool, buttons: [{text,url}], chatId }
const notify = (message, opts = {}) => {
  if (!isConfigured()) return; // silent no-op in dev
  const chatId = opts.chatId || process.env.TELEGRAM_CHAT_ID;
  const body = {
    chat_id: chatId,
    text: decorate(message, opts),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  const keyboard = buildKeyboard(opts.buttons);
  if (keyboard) body.reply_markup = keyboard;
  post('sendMessage', body).catch((err) => console.warn('[telegram] notify failed:', err.message));
};

// Send a message and return the Telegram message_id so we can later
// route long-press replies back to the visitor thread.
const sendAndReturnId = async (message, opts = {}) => {
  if (!isConfigured()) return null;
  const chatId = opts.chatId || process.env.TELEGRAM_CHAT_ID;
  try {
    const body = {
      chat_id: chatId,
      text: decorate(message, opts),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    const keyboard = buildKeyboard(opts.buttons);
    if (keyboard) body.reply_markup = keyboard;
    const result = await post('sendMessage', body);
    return result?.message_id ?? null;
  } catch (err) {
    console.warn('[telegram] sendAndReturnId failed:', err.message);
    return null;
  }
};

module.exports = { notify, sendAndReturnId, escapeHtml, isConfigured, formatTimestamp };
