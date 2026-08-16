// src/models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: {  // Changed from userId to user
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['USDT (TRC20)', 'USDT (ERC20)', 'Ethereum', 'BTC (Main)', 'BTC (Secondary)', 'wallet'],
    default: 'wallet'
  },
  walletAddress: {
    type: String
  },
  reference: {
    type: String,
    required: true,
    unique: true
  },
  balanceBefore: {  // Added this field
    type: Number,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', transactionSchema);