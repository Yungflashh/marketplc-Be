// controllers/adminController.js
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const Product = require('../models/Product.model');
const Order = require('../models/Order.model');
const { sendEmail } = require('../utils/email');
const { fraudWarningEmail } = require('../emails/fraudWarningEmail');
const { notify, escapeHtml } = require('../utils/telegram');
const { createUserNotification } = require('../utils/userNotify');

const WARNING_EMAIL_SUBJECT = 'Important account warning — ShopLogs';

// Get All Transactions (Admin)

const getAllTransactions = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;

    const transactions = await Transaction.find(query)
      .populate('user', 'name email isBanned banExpiresAt failedTransactionCount lastWarningEmailAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get all transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions'
    });
  }
};

// Update Transaction Status (Admin - Approve/Reject)
const updateTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!['completed', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be either "completed" or "failed"'
      });
    }

    const trimmedReason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';

    if (status === 'failed' && !trimmedReason) {
      return res.status(400).json({
        success: false,
        message: 'A rejection reason is required when rejecting a transaction'
      });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Transaction has already been processed'
      });
    }

    transaction.status = status;

    if (status === 'failed') {
      transaction.rejectionReason = trimmedReason;
    } else {
      transaction.rejectionReason = '';
    }

    // Load the owning user once so we can update wallet AND fraud counter atomically.
    const owner = await User.findById(transaction.user);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (status === 'completed') {
      if (transaction.type === 'credit') {
        owner.walletBalance += transaction.amount;
        transaction.balanceAfter = owner.walletBalance;
      }
      // Approval is a positive signal — reset the consecutive-failure streak.
      owner.failedTransactionCount = 0;
    } else if (status === 'failed' && transaction.type === 'credit') {
      // Only funding rejections count toward the fraud streak.
      owner.failedTransactionCount = (owner.failedTransactionCount || 0) + 1;
    }

    await owner.save();
    await transaction.save();

    const verb = status === 'completed' ? 'approved ✅' : 'rejected ❌';
    notify(`💸 <b>Funding ${verb}</b>\n${escapeHtml(owner.name)} · $${transaction.amount.toFixed(2)}\nRef: <code>${escapeHtml(transaction.reference)}</code>${status === 'failed' && trimmedReason ? `\nReason: ${escapeHtml(trimmedReason)}` : ''}`);

    createUserNotification({
      userId: owner._id,
      type: status === 'completed' ? 'funding_approved' : 'funding_rejected',
      title: status === 'completed'
        ? `$${transaction.amount.toFixed(2)} credited to your wallet`
        : `Funding request was rejected`,
      body: status === 'completed'
        ? `Your funding request has been approved. Ref: ${transaction.reference}`
        : `Reason: ${trimmedReason || 'No reason provided'}`,
      link: `/wallet`,
    });

    res.status(200).json({
      success: true,
      message: `Transaction ${status === 'completed' ? 'approved' : 'rejected'} successfully`,
      data: {
        transaction,
        userFailedTransactionCount: owner.failedTransactionCount || 0,
      }
    });
  } catch (error) {
    console.error('Update transaction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating transaction'
    });
  }
};

// Get Dashboard Stats (Admin)
const LOW_STOCK_THRESHOLD = 3;
const EXPIRING_BAN_WINDOW_HOURS = 48;

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    const expiringBanCutoff = new Date(now.getTime() + EXPIRING_BAN_WINDOW_HOURS * 60 * 60 * 1000);

    const [
      totalProducts,
      totalOrders,
      totalUsers,
      revenueAgg,
      avgItemsAgg,
      walletLiabilityAgg,
      todayOrdersAgg,
      yesterdayOrdersAgg,
      todaySignups,
      yesterdaySignups,
      pendingTransactionsCount,
      pendingOrdersCount,
      lowStockProducts,
      expiringBans,
      revenueTrendAgg,
    ] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      User.countDocuments(),
      Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $project: { itemCount: { $sum: '$items.quantity' } } },
        { $group: { _id: null, avg: { $avg: '$itemCount' } } },
      ]),
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$walletBalance' } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: yesterdayStart, $lt: todayStart } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
      ]),
      User.countDocuments({ createdAt: { $gte: todayStart } }),
      User.countDocuments({ createdAt: { $gte: yesterdayStart, $lt: todayStart } }),
      Transaction.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'pending' }),
      Product.find({ isActive: true, quantity: { $lte: LOW_STOCK_THRESHOLD } })
        .select('name quantity price imageUrl category')
        .sort({ quantity: 1 })
        .limit(5)
        .lean(),
      User.find({
        isBanned: true,
        banExpiresAt: { $gt: now, $lte: expiringBanCutoff },
      })
        .select('name email banExpiresAt banReason')
        .sort({ banExpiresAt: 1 })
        .limit(5)
        .lean(),
      Order.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            orders: { $sum: 1 },
            revenue: { $sum: '$totalAmount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Fill in missing days so the chart always has exactly 30 buckets
    const trendMap = new Map(revenueTrendAgg.map((d) => [d._id, d]));
    const revenueTrend = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      revenueTrend.push({
        date: key,
        orders: bucket?.orders || 0,
        revenue: bucket?.revenue || 0,
      });
    }

    const totalRevenue = revenueAgg[0]?.totalRevenue || 0;
    const avgItemsPerOrder = avgItemsAgg[0]?.avg || 0;
    const walletLiability = walletLiabilityAgg[0]?.total || 0;
    const today = {
      orders: todayOrdersAgg[0]?.count || 0,
      revenue: todayOrdersAgg[0]?.revenue || 0,
      signups: todaySignups,
    };
    const yesterday = {
      orders: yesterdayOrdersAgg[0]?.count || 0,
      revenue: yesterdayOrdersAgg[0]?.revenue || 0,
      signups: yesterdaySignups,
    };

    const systemHealth = [
      { name: 'MongoDB', ok: mongoose.connection.readyState === 1 },
      { name: 'Groq API', ok: !!process.env.GROQ_API_KEY },
      { name: 'Resend email', ok: !!process.env.RESEND_API_KEY },
    ];

    res.status(200).json({
      success: true,
      data: {
        totals: {
          products: totalProducts,
          orders: totalOrders,
          users: totalUsers,
          revenue: totalRevenue,
          avgItemsPerOrder,
          avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
          walletLiability,
        },
        today,
        yesterday,
        queues: {
          pendingTransactionsCount,
          pendingOrdersCount,
          lowStockProducts,
          expiringBans,
        },
        revenueTrend,
        systemHealth,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats',
    });
  }
};

// ============================================================
// Ban / Unban a user
// ============================================================
const banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { days, reason } = req.body;

    const numericDays = Number(days);
    if (!Number.isFinite(numericDays) || numericDays <= 0 || numericDays > 3650) {
      return res.status(400).json({
        success: false,
        message: 'Ban duration must be between 1 and 3650 days',
      });
    }

    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      return res.status(400).json({
        success: false,
        message: 'A ban reason is required',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Admin accounts cannot be banned' });
    }

    const expires = new Date(Date.now() + numericDays * 24 * 60 * 60 * 1000);
    user.isBanned = true;
    user.banExpiresAt = expires;
    user.banReason = trimmedReason;
    await user.save();

    notify(`🚫 <b>User banned</b>\n${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n${numericDays} day(s)\nReason: ${escapeHtml(trimmedReason)}`);

    res.json({
      success: true,
      message: `User banned for ${numericDays} day${numericDays === 1 ? '' : 's'}`,
      data: { user },
    });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ success: false, message: 'Error banning user' });
  }
};

const unbanUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isBanned = false;
    user.banExpiresAt = null;
    user.banReason = '';
    // Give the user a clean slate on unban.
    user.failedTransactionCount = 0;
    await user.save();

    res.json({ success: true, message: 'User unbanned', data: { user } });
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ success: false, message: 'Error unbanning user' });
  }
};

// ============================================================
// Fraud warning email — preview + send
// ============================================================
const buildWarningEmail = (user) => {
  const failedCount = user.failedTransactionCount || 0;
  return {
    subject: WARNING_EMAIL_SUBJECT,
    html: fraudWarningEmail({ name: user.name, failedCount }),
    to: user.email,
    failedCount,
  };
};

const previewWarningEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('name email failedTransactionCount lastWarningEmailAt');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const preview = buildWarningEmail(user);
    res.json({
      success: true,
      data: {
        subject: preview.subject,
        html: preview.html,
        to: preview.to,
        failedCount: preview.failedCount,
        lastWarningEmailAt: user.lastWarningEmailAt,
      },
    });
  } catch (error) {
    console.error('Preview warning email error:', error);
    res.status(500).json({ success: false, message: 'Error building preview' });
  }
};

const sendWarningEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { subject, html } = buildWarningEmail(user);
    await sendEmail(user.email, subject, html);

    user.lastWarningEmailAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: `Warning email sent to ${user.email}`,
      data: { user },
    });
  } catch (error) {
    console.error('Send warning email error:', error);
    res.status(500).json({ success: false, message: 'Error sending warning email' });
  }
};

module.exports = {
  getAllTransactions,
  updateTransactionStatus,
  getDashboardStats,
  banUser,
  unbanUser,
  previewWarningEmail,
  sendWarningEmail,
};