// Weekly analytics digest — posted to Telegram every Monday 09:00 UTC.
// Covers the previous 7 rolling days.

const cron = require('node-cron');
const mongoose = require('mongoose');
const Order = require('../models/Order.model');
const User = require('../models/User.model');
const Transaction = require('../models/Transaction.model');
const Product = require('../models/Product.model');
const { notify, escapeHtml } = require('../utils/telegram');

const WINDOW_DAYS = 7;

const pct = (curr, prev) => {
  if (!prev) return curr > 0 ? '+∞%' : '0%';
  const diff = ((curr - prev) / prev) * 100;
  const arrow = diff >= 0 ? '⬆️' : '⬇️';
  return `${arrow} ${Math.abs(diff).toFixed(1)}%`;
};

const runWeeklyDigest = async () => {
  try {
    const now = new Date();
    const weekStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const prevWeekStart = new Date(weekStart.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      ordersThis, ordersPrev,
      revenueThisAgg, revenuePrevAgg,
      signupsThis, signupsPrev,
      cancelledThis,
      completedThis,
      pendingFunding,
      lowStock,
      topProductsAgg,
      newDepositAgg,
      totalActiveUsers,
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: weekStart } }),
      Order.countDocuments({ createdAt: { $gte: prevWeekStart, $lt: weekStart } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: weekStart }, status: { $in: ['completed', 'processing'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: prevWeekStart, $lt: weekStart }, status: { $in: ['completed', 'processing'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      User.countDocuments({ createdAt: { $gte: weekStart } }),
      User.countDocuments({ createdAt: { $gte: prevWeekStart, $lt: weekStart } }),
      Order.countDocuments({ createdAt: { $gte: weekStart }, status: 'cancelled' }),
      Order.countDocuments({ createdAt: { $gte: weekStart }, status: 'completed' }),
      Transaction.countDocuments({ status: 'pending', type: 'credit' }),
      Product.countDocuments({ isActive: true, quantity: { $lte: 3 } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: weekStart } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productName',
            units: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { units: -1 } },
        { $limit: 5 },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: weekStart }, type: 'credit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      User.countDocuments({ lastLoginAt: { $gte: weekStart } }),
    ]);

    const revenueThis = revenueThisAgg[0]?.total || 0;
    const revenuePrev = revenuePrevAgg[0]?.total || 0;
    const depositTotal = newDepositAgg[0]?.total || 0;
    const depositCount = newDepositAgg[0]?.count || 0;

    const topLines = topProductsAgg.length
      ? topProductsAgg
          .map((p, i) => `${i + 1}. ${escapeHtml(p._id || 'unknown')} — ${p.units} unit(s) · $${p.revenue.toFixed(2)}`)
          .join('\n')
      : '—';

    const totalUsers = await User.countDocuments();

    const msg =
      `📊 <b>Weekly digest</b>\n` +
      `<i>${weekStart.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}</i>\n\n` +
      `<b>Orders</b>\n` +
      `Placed: <b>${ordersThis}</b> ${pct(ordersThis, ordersPrev)}\n` +
      `Completed: ${completedThis} · Cancelled: ${cancelledThis}\n\n` +
      `<b>Revenue</b>\n` +
      `$${revenueThis.toFixed(2)} ${pct(revenueThis, revenuePrev)}\n\n` +
      `<b>Growth</b>\n` +
      `New signups: <b>${signupsThis}</b> ${pct(signupsThis, signupsPrev)}\n` +
      `Active this week: ${totalActiveUsers} / ${totalUsers}\n\n` +
      `<b>Wallet</b>\n` +
      `Approved deposits: $${depositTotal.toFixed(2)} (${depositCount})\n` +
      `Pending funding: ${pendingFunding}\n\n` +
      `<b>Inventory</b>\n` +
      `Low-stock products: ${lowStock}\n\n` +
      `<b>Top products</b>\n${topLines}`;

    notify(msg);
  } catch (err) {
    console.warn('[jobs] weekly digest failed:', err.message);
  }
};

exports.start = () => {
  // Every Monday at 09:00 UTC
  cron.schedule('0 9 * * 1', runWeeklyDigest, { timezone: 'UTC' });
  console.log('[jobs] weekly analytics digest scheduled (Mon 09:00 UTC)');
};

exports.runWeeklyDigest = runWeeklyDigest;
