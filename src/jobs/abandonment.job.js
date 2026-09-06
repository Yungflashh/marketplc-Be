// Scheduled jobs that scan for stale carts (never checked out) and stale
// checkouts (in-progress but not completed). Each fires at most one Telegram
// alert per user per stale-window to avoid daily spam.
const cron = require('node-cron');
const Cart = require('../models/Cart.model');
const Order = require('../models/Order.model');
const User = require('../models/User.model');
const { notify, escapeHtml } = require('../utils/telegram');

// Windows are intentionally generous — this is a "someone was close to buying"
// signal, not a hard SLA.
const ABANDONED_CART_HOURS = 24;
const ABANDONED_CHECKOUT_HOURS = 2;

// In-memory dedupe so a stale cart isn't reported on every cron tick.
const alertedCarts = new Map();
const alertedOrders = new Map();
const DEDUPE_MS = 24 * 60 * 60 * 1000;

const shouldAlert = (map, key) => {
  const last = map.get(key) || 0;
  if (Date.now() - last < DEDUPE_MS) return false;
  map.set(key, Date.now());
  return true;
};

const scanAbandonedCarts = async () => {
  try {
    const cutoff = new Date(Date.now() - ABANDONED_CART_HOURS * 60 * 60 * 1000);
    const carts = await Cart.find({
      updatedAt: { $lt: cutoff },
      'items.0': { $exists: true },
    })
      .populate('items.product', 'name price')
      .limit(20);

    for (const cart of carts) {
      const key = String(cart._id);
      if (!shouldAlert(alertedCarts, key)) continue;

      const user = await User.findById(cart.user).select('name email');
      if (!user) continue;

      const total = (cart.items || []).reduce(
        (sum, i) => sum + (i.quantity || 0) * (i.product?.price || 0),
        0
      );
      const itemCount = (cart.items || []).reduce((sum, i) => sum + (i.quantity || 0), 0);
      const hoursIdle = Math.floor((Date.now() - new Date(cart.updatedAt).getTime()) / (60 * 60 * 1000));

      notify(
        `🛒 <b>Abandoned cart</b>\n` +
          `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
          `<b>${itemCount}</b> item(s) · $${total.toFixed(2)}\n` +
          `Idle for ${hoursIdle}h`,
        { severity: 'warn' }
      );
    }
  } catch (err) {
    console.warn('[jobs] abandoned-cart scan failed:', err.message);
  }
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
  // Every hour, on the hour
  cron.schedule('0 * * * *', scanAbandonedCarts);
  // Every 30 minutes
  cron.schedule('*/30 * * * *', scanAbandonedCheckouts);
  console.log('[jobs] abandonment scanners scheduled');
};

exports.scanAbandonedCarts = scanAbandonedCarts;
exports.scanAbandonedCheckouts = scanAbandonedCheckouts;
