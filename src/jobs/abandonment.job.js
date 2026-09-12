// Scheduled job that scans for stale checkouts (in-progress but not
// completed) and fires at most one Telegram alert per order per stale-window
// to avoid daily spam.
const cron = require('node-cron');
const Order = require('../models/Order.model');
const { notify, escapeHtml } = require('../utils/telegram');

const ABANDONED_CHECKOUT_HOURS = 2;

const alertedOrders = new Map();
const DEDUPE_MS = 24 * 60 * 60 * 1000;

const shouldAlert = (map, key) => {
  const last = map.get(key) || 0;
  if (Date.now() - last < DEDUPE_MS) return false;
  map.set(key, Date.now());
  return true;
};

const scanAbandonedCheckouts = async () => {
  try {
    const cutoff = new Date(Date.now() - ABANDONED_CHECKOUT_HOURS * 60 * 60 * 1000);
    const orders = await Order.find({
      status: { $in: ['pending', 'in-review'] },
      createdAt: { $lt: cutoff },
    })
      .populate('user', 'name email')
      .limit(20);

    for (const order of orders) {
      const key = String(order._id);
      if (!shouldAlert(alertedOrders, key)) continue;
      if (!order.user) continue;

      const hoursIdle = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / (60 * 60 * 1000));
      notify(
        `⏳ <b>Stale checkout</b>\n` +
          `#${order.orderNumber} · ${escapeHtml(order.user.name)}\n` +
          `Status: <b>${escapeHtml(order.status)}</b> for ${hoursIdle}h\n` +
          `Total: $${order.totalAmount.toFixed(2)}`,
        { severity: 'warn' }
      );
    }
  } catch (err) {
    console.warn('[jobs] abandoned-checkout scan failed:', err.message);
  }
};

exports.start = () => {
  cron.schedule('*/30 * * * *', scanAbandonedCheckouts);
  console.log('[jobs] abandonment scanners scheduled');
};

exports.scanAbandonedCheckouts = scanAbandonedCheckouts;
