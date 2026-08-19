// controllers/adminController.js
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const { sendEmail } = require('../utils/email');
const { fraudWarningEmail } = require('../emails/fraudWarningEmail');

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
const getDashboardStats = async (req, res) => {
  try {
    const Product = require('../models/Product');
    const Order = require('../models/Order');

    const [products, orders, transactions] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      Transaction.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        }
      ])
    ]);

    const completedOrders = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
    ]);

    const transactionStats = {
      total: 0,
      pending: 0,
      completed: 0,
      failed: 0,
      totalAmount: 0
    };

    transactions.forEach(stat => {
      transactionStats.total += stat.count;
      transactionStats[stat._id] = stat.count;
      if (stat._id === 'completed') {
        transactionStats.totalAmount = stat.totalAmount;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalProducts: products,
        totalOrders: orders,
        totalRevenue: completedOrders[0]?.totalRevenue || 0,
        transactions: transactionStats
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats'
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