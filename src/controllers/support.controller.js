const SupportChat = require('../models/SupportChat.model');
const SupportMessage = require('../models/SupportMessage.model');
const { notify, sendAndReturnId, escapeHtml, isConfigured } = require('../utils/telegram');
const { extract, renderBlock } = require('../utils/requestContext');

const MAX_MESSAGE_LENGTH = 2000;

const findOrCreateChat = async ({ sessionId, user, visitorName, visitorEmail }) => {
  if (!sessionId) throw new Error('sessionId is required');
  let chat = await SupportChat.findOne({ sessionId });
  if (!chat) {
    chat = await SupportChat.create({
      sessionId,
      user: user?._id || null,
      visitorName: visitorName || user?.name || '',
      visitorEmail: visitorEmail || user?.email || '',
    });
  } else {
    let dirty = false;
    if (user && !chat.user) { chat.user = user._id; dirty = true; }
    if (user?.name && !chat.visitorName) { chat.visitorName = user.name; dirty = true; }
    if (user?.email && !chat.visitorEmail) { chat.visitorEmail = user.email; dirty = true; }
    if (visitorName && !chat.visitorName) { chat.visitorName = visitorName; dirty = true; }
    if (visitorEmail && !chat.visitorEmail) { chat.visitorEmail = visitorEmail; dirty = true; }
    if (dirty) await chat.save();
  }
  return chat;
};

// POST /api/support/message
// Body: { sessionId, text, visitorName?, visitorEmail? }
// Auth: optional (attaches user if logged in).
exports.sendMessage = async (req, res) => {
  try {
    const { sessionId, text, visitorName, visitorEmail } = req.body;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }
    const trimmed = String(text || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    const priorMessageCount = await SupportMessage.countDocuments({
      chat: { $in: await SupportChat.find({ sessionId }).distinct('_id') },
    });
    const isNewSession = priorMessageCount === 0;

    const chat = await findOrCreateChat({
      sessionId,
      user: req.user,
      visitorName,
      visitorEmail,
    });

    // Fire a "new chat opened" ping before we forward the first message.
    if (isNewSession) {
      const ctxNew = extract(req);
      notify(
        `💭 <b>New support chat opened</b>\n` +
          `Session: <code>${escapeHtml(sessionId.slice(0, 8))}</code>\n` +
          (req.user ? `User: ${escapeHtml(req.user.name)} &lt;${escapeHtml(req.user.email)}&gt;\n` : 'Guest visitor\n') +
          (req.body?.currentPath ? `Page: ${escapeHtml(req.body.currentPath)}\n` : '') +
          `\n` + renderBlock(ctxNew)
      );
    }

    // Persist visitor message first so it appears immediately even if Telegram fails
    const message = await SupportMessage.create({
      chat: chat._id,
      sender: 'visitor',
      text: trimmed,
    });

    // Nth message in this chat
    const msgNumber = (await SupportMessage.countDocuments({ chat: chat._id })) || 1;

    // Priors: has this visitor chatted before?
    const priorChatCount = req.user
      ? await SupportChat.countDocuments({ user: req.user._id, _id: { $ne: chat._id } })
      : 0;

    const ctx = extract(req);
    const geoLine = ctx.geo
      ? `\n📍 ${escapeHtml([ctx.geo.city, ctx.geo.country].filter(Boolean).join(', '))}`
      : '';
    const currentPath = String(req.body?.currentPath || req.headers.referer || '').slice(0, 120);

    // Forward to admin's Telegram. Long-press-reply → routed back via webhook.
    const identity = chat.user
      ? `User: ${escapeHtml(chat.visitorName || '')} &lt;${escapeHtml(chat.visitorEmail || '')}&gt;`
      : `Guest ${escapeHtml(chat.sessionId.slice(0, 8))}${chat.visitorName ? ` · ${escapeHtml(chat.visitorName)}` : ''}${chat.visitorEmail ? ` · ${escapeHtml(chat.visitorEmail)}` : ''}`;

    const meta = [`#${msgNumber} in session`];
    if (priorChatCount > 0) meta.push(`${priorChatCount} prior chat(s)`);
    if (currentPath) meta.push(`from ${escapeHtml(currentPath)}`);

    const tgText =
      `💬 <b>Support message</b>\n${identity}${geoLine}\n` +
      `<i>${meta.join(' · ')}</i>\n\n` +
      `${escapeHtml(trimmed)}\n\n` +
      `<i>Long-press &amp; Reply to answer.</i>`;
    const telegramMessageId = await sendAndReturnId(tgText);

    if (telegramMessageId) {
      message.telegramMessageId = telegramMessageId;
      await message.save();
    }

    chat.lastActivityAt = new Date();
    chat.unreadForAdmin += 1;
    await chat.save();

    res.status(201).json({
      success: true,
      data: {
        message: {
          _id: message._id,
          sender: message.sender,
          text: message.text,
          createdAt: message.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Support send error:', error);
    res.status(500).json({ success: false, message: 'Error sending message', error: error.message });
  }
};

// GET /api/support/mine?sessionId=...&since=<iso>
// Returns all messages for this session (or messages after `since`).
// Auth: optional.
exports.pollMine = async (req, res) => {
  try {
    const { sessionId, since } = req.query;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }
    const chat = await SupportChat.findOne({ sessionId });
    if (!chat) {
      return res.json({ success: true, data: { messages: [], lastActivityAt: null } });
    }

    const filter = { chat: chat._id };
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) filter.createdAt = { $gt: d };
    }
    const messages = await SupportMessage.find(filter)
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    // Mark admin messages as seen by visitor
    if (chat.unreadForVisitor > 0 && !since) {
      chat.unreadForVisitor = 0;
      await chat.save();
    }

    res.json({
      success: true,
      data: {
        messages: messages.map((m) => ({
          _id: m._id,
          sender: m.sender,
          text: m.text,
          createdAt: m.createdAt,
        })),
        lastActivityAt: chat.lastActivityAt,
      },
    });
  } catch (error) {
    console.error('Support poll error:', error);
    res.status(500).json({ success: false, message: 'Error fetching messages', error: error.message });
  }
};

// POST /api/support/webhook — receives Telegram updates.
// Auth: X-Telegram-Bot-Api-Secret-Token header must match TELEGRAM_WEBHOOK_SECRET.
exports.webhook = async (req, res) => {
  try {
    const secret = req.header('x-telegram-bot-api-secret-token');
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const update = req.body || {};
    const message = update.message;
    // We only care about replies from the admin's chat.
    if (!message || !message.reply_to_message || !message.text) {
      return res.json({ ok: true });
    }
    if (process.env.TELEGRAM_CHAT_ID && String(message.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
      // Message from a chat other than the admin's — ignore.
      return res.json({ ok: true });
    }

    const repliedToId = message.reply_to_message.message_id;
    const original = await SupportMessage.findOne({ telegramMessageId: repliedToId });
    if (!original) {
      // Reply to a message we didn't track — nothing to route.
      return res.json({ ok: true });
    }

    const chat = await SupportChat.findById(original.chat);
    if (!chat) return res.json({ ok: true });

    await SupportMessage.create({
      chat: chat._id,
      sender: 'admin',
      text: String(message.text).slice(0, MAX_MESSAGE_LENGTH),
    });

    chat.unreadForVisitor += 1;
    chat.unreadForAdmin = 0;
    chat.lastActivityAt = new Date();
    await chat.save();

    res.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    // Always 200 to Telegram — otherwise it retries aggressively.
    res.json({ ok: true });
  }
};

// GET /api/support/status — is Telegram wired up?
exports.status = (_req, res) => {
  res.json({ success: true, data: { telegramConfigured: isConfigured() } });
};

// Also expose notify so other controllers can import from this module if they want.
exports._notify = notify;
