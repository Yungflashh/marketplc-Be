// src/controllers/wallet.controller.js
const Transaction = require('../models/Transaction.model');
const User = require('../models/User.model');
const crypto = require('crypto');
const { notify, escapeHtml } = require('../utils/telegram');
const { extract, renderBlock } = require('../utils/requestContext');

// Generate unique reference
const generateReference = () => {
  return 'TXN-' + crypto.randomBytes(8).toString('hex').toUpperCase();
};

// Fund Wallet (User submits payment)
const fundWallet = async (req, res) => {
  try {
    const { amount, paymentMethod, walletAddress } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount'
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Please select a payment method'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create pending transaction
    const transaction = await Transaction.create({
      user: userId,  // Changed from userId to user
      type: 'credit',
      amount,
      description: `Wallet funding via ${paymentMethod}`,
      status: 'pending',
      paymentMethod,
      walletAddress,
      reference: generateReference(),
      balanceBefore: user.walletBalance,  // Added balanceBefore
      balanceAfter: user.walletBalance // Balance unchanged until approved
    });

    // Lifetime deposit stats for context
    const [completedCreditAgg, completedCreditCount] = await Promise.all([
      Transaction.aggregate([
        { $match: { user: user._id, type: 'credit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.countDocuments({ user: user._id, type: 'credit', status: 'completed' }),
    ]);
    const lifetimeDeposits = completedCreditAgg[0]?.total || 0;
    const firstTimerBadge = completedCreditCount === 0 ? '🆕 <b>First-time depositor</b>\n' : '';

    const ctx = extract(req);
    const ctxBlock = renderBlock(ctx);

    notify(
      `💰 <b>Funding request</b>\n` +
        firstTimerBadge +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
        `<b>$${Number(amount).toFixed(2)}</b> via ${escapeHtml(paymentMethod)}\n` +
        `Ref: <code>${escapeHtml(transaction.reference)}</code>\n` +
        `Current balance: $${(user.walletBalance || 0).toFixed(2)}\n` +
        `Lifetime deposits: $${lifetimeDeposits.toFixed(2)} (${completedCreditCount})` +
        (ctxBlock ? `\n\n${ctxBlock}` : '')
    );

    res.status(201).json({
      success: true,
      message: 'Payment submitted successfully. Waiting for admin approval.',
      data: {
        transaction
      }
    });
  } catch (error) {
    console.error('Fund wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing payment request',
      error: error.message
    });
  }
};

// Get User Transactions
const getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;

    const transactions = await Transaction.find({ user: userId })  // Changed from userId to user
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      data: {
        transactions
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions'
    });
  }
};

// Get Wallet Balance
const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId).select('walletBalance');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        walletBalance: user.walletBalance
      }
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching wallet balance'
    });
  }
};

// Admin: Directly credit or debit a user's wallet
const adminUpdateWallet = async (req, res) => {
  try {
    const { userId, amount, action, description } = req.body;

    if (!userId || !amount || !action) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, and action are required'
      });
    }

    if (!['credit', 'debit'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be "credit" or "debit"'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (action === 'debit' && user.walletBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    const balanceBefore = user.walletBalance;

    if (action === 'credit') {
      user.walletBalance += amount;
    } else {
      user.walletBalance -= amount;
    }

    await user.save();

    const transaction = await Transaction.create({
      user: userId,
      type: action,
      amount,
      description: description || `Admin ${action}`,
      status: 'completed',
      paymentMethod: 'wallet',
      reference: generateReference(),
      balanceBefore,
      balanceAfter: user.walletBalance
    });

    res.status(200).json({
      success: true,
      message: `Wallet ${action}ed successfully`,
      data: { transaction, newBalance: user.walletBalance }
    });
  } catch (error) {
    console.error('Admin update wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating wallet'
    });
  }
};

module.exports = {
  fundWallet,
  getTransactions,
  getWalletBalance,
  adminUpdateWallet
};