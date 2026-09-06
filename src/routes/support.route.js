const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support.controller');
const { optionalAuth } = require('../middleware/auth.middleware');

// Visitor endpoints (auth optional — logged-in users get attached automatically)
router.post('/message', optionalAuth, supportController.sendMessage);
router.get('/mine', optionalAuth, supportController.pollMine);
router.get('/status', supportController.status);

// Telegram webhook — protected by X-Telegram-Bot-Api-Secret-Token header
router.post('/webhook', supportController.webhook);

module.exports = router;
