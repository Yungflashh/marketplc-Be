// Weekly analytics digest — posted to Telegram every Monday 09:00 UTC and
// exposed via GET /api/admin/analytics/weekly for the admin UI.

const cron = require('node-cron');
const Order = require('../models/Order.model');
const User = require('../models/User.model');
const Transaction = require('../models/Transaction.model');
const Product = require('../models/Product.model');
const { notify, escapeHtml } = require('../utils/telegram');

const WINDOW_DAYS = 7;

const pctChange = (curr, prev) => {
  if (!prev) return curr > 0 ? Infinity : 0;
  return ((curr - prev) / prev) * 100;
};

const pctString = (curr, prev) => {
  const p = pctChange(curr, prev);
  if (p === Infinity) return '+∞%';
  const arrow = p >= 0 ? '⬆️' : '⬇️';
  return `${arrow} ${Math.abs(p).toFixed(1)}%`;
};

// Pure data function — no side effects. Reused by the cron formatter and the API endpoint.
const getWeeklyStats = async () => {
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
    activeThisWeek,
    totalUsers,
    dailyTrendAgg,
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
    User.countDocuments(),
    Order.aggregate([
      { $match: { createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const revenueThis = revenueThisAgg[0]?.total || 0;
  const revenuePrev = revenuePrevAgg[0]?.total || 0;
  const depositTotal = newDepositAgg[0]?.total || 0;
  const depositCount = newDepositAgg[0]?.count || 0;

  // Fill every day in the range so the FE can render a smooth chart.
  const trendMap = new Map(dailyTrendAgg.map((d) => [d._id, d]));
  const dailyTrend = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const bucket = trendMap.get(key);
    dailyTrend.push({
      date: key,
      orders: bucket?.orders || 0,
      revenue: bucket?.revenue || 0,
    });
  }

  return {
    windowStart: weekStart.toISOString(),
    windowEnd: now.toISOString(),
    orders: {
      placed: ordersThis,
      placedPrev: ordersPrev,
      placedChangePct: pctChange(ordersThis, ordersPrev),
      completed: completedThis,
      cancelled: cancelledThis,
    },
    revenue: {
      total: revenueThis,
      totalPrev: revenuePrev,
      changePct: pctChange(revenueThis, revenuePrev),
    },
    growth: {
      signups: signupsThis,
      signupsPrev,
      signupsChangePct: pctChange(signupsThis, signupsPrev),
      activeUsers: activeThisWeek,
      totalUsers,
    },
    wallet: {
      depositsTotal: depositTotal,
      depositsCount: depositCount,
      pendingFunding,
    },
    inventory: {
      lowStock,
    },
    topProducts: topProductsAgg.map((p) => ({
      name: p._id || 'Unknown',
      units: p.units,
      revenue: p.revenue,
    })),
    dailyTrend,
  };
};

const runWeeklyDigest = async () => {
  try {
    const s = await getWeeklyStats();

    const topLines = s.topProducts.length
      ? s.topProducts
          .map((p, i) => `${i + 1}. ${escapeHtml(p.name)} — ${p.units} unit(s) · $${p.revenue.toFixed(2)}`)
          .join('\n')
      : '—';

    const msg =
      `📊 <b>Weekly digest</b>\n` +
      `<i>${s.windowStart.slice(0, 10)} → ${s.windowEnd.slice(0, 10)}</i>\n\n` +
      `<b>Orders</b>\n` +
      `Placed: <b>${s.orders.placed}</b> ${pctString(s.orders.placed, s.orders.placedPrev)}\n` +
      `Completed: ${s.orders.completed} · Cancelled: ${s.orders.cancelled}\n\n` +
      `<b>Revenue</b>\n` +
      `$${s.revenue.total.toFixed(2)} ${pctString(s.revenue.total, s.revenue.totalPrev)}\n\n` +
      `<b>Growth</b>\n` +
      `New signups: <b>${s.growth.signups}</b> ${pctString(s.growth.signups, s.growth.signupsPrev)}\n` +
      `Active this week: ${s.growth.activeUsers} / ${s.growth.totalUsers}\n\n` +
      `<b>Wallet</b>\n` +
      `Approved deposits: $${s.wallet.depositsTotal.toFixed(2)} (${s.wallet.depositsCount})\n` +
      `Pending funding: ${s.wallet.pendingFunding}\n\n` +
      `<b>Inventory</b>\n` +
      `Low-stock products: ${s.inventory.lowStock}\n\n` +
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
exports.getWeeklyStats = getWeeklyStats;
