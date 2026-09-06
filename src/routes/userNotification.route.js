const express = require('express');
const router = express.Router();
const controller = require('../controllers/userNotification.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/me', controller.list);
router.get('/me/unread-count', controller.unreadCount);
router.patch('/me/read-all', controller.markAllRead);
router.patch('/me/:id/read', controller.markRead);
router.delete('/me/:id', controller.remove);
router.delete('/me', controller.clearAll);

module.exports = router;
