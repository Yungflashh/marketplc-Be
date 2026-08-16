// controllers/adminController.js
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');

// Get All Transactions (Admin)

const getAllTransactions = async (req, res) => {
  try {
    const { status, type, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;

    const transactions = await Transaction.find(query)
      .populate('user', 'name email')  // Changed from userId to user
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

    // If approved (completed), credit the user's wallet
    if (status === 'completed' && transaction.type === 'credit') {
      const user = await User.findById(transaction.user);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      user.walletBalance += transaction.amount;
      transaction.balanceAfter = user.walletBalance;
      await user.save();
    }

    await transaction.save();

    res.status(200).json({
      success: true,
      message: `Transaction ${status === 'completed' ? 'approved' : 'rejected'} successfully`,
      data: {
        transaction
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

module.exports = {
  getAllTransactions,
  updateTransactionStatus,
  getDashboardStats
};