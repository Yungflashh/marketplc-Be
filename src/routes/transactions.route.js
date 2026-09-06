// src/routes/admin.route.js
const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const {
  getAllTransactions,
  updateTransactionStatus,
  getDashboardStats
} = require('../controllers/Admin.Controller');
const { getWeeklyStats, runWeeklyDigest } = require('../jobs/analytics.job');

// Transaction Management Routes
router.get('/transactions', authenticate, isAdmin, getAllTransactions);
router.patch('/transactions/:transactionId', authenticate, isAdmin, updateTransactionStatus);

// Dashboard Stats Route
router.get('/dashboard/stats', authenticate, isAdmin, getDashboardStats);

// Weekly analytics — same numbers the Monday-morning Telegram digest posts
router.get('/analytics/weekly', authenticate, isAdmin, async (req, res) => {
  try {
    const stats = await getWeeklyStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('weekly analytics error:', error);
    res.status(500).json({ success: false, message: 'Error fetching weekly analytics' });
  }
});

// Manually trigger the Telegram digest — useful for testing without waiting for Monday
router.post('/analytics/weekly/send', authenticate, isAdmin, async (req, res) => {
  await runWeeklyDigest();
  res.json({ success: true, message: 'Digest posted to Telegram' });
});

module.exports = router;