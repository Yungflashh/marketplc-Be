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

// Fire-and-forget notification to the admin chat. Never throws.
const notify = (message, chatId = process.env.TELEGRAM_CHAT_ID) => {
  if (!isConfigured()) return; // silent no-op in dev
  post('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }).catch((err) => console.warn('[telegram] notify failed:', err.message));
};

// Send a message and return the Telegram message_id so we can later
// route long-press replies back to the visitor thread.
const sendAndReturnId = async (message, chatId = process.env.TELEGRAM_CHAT_ID) => {
  if (!isConfigured()) return null;
  try {
    const result = await post('sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return result?.message_id ?? null;
  } catch (err) {
    console.warn('[telegram] sendAndReturnId failed:', err.message);
    return null;
  }
};

module.exports = { notify, sendAndReturnId, escapeHtml, isConfigured };
