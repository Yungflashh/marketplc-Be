const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controllers');
const adminController = require('../controllers/Admin.Controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// Admin routes
router.get('/', authenticate, isAdmin, userController.getAllUsers);
router.get('/:id', authenticate, isAdmin, userController.getUserById);
router.patch('/:id/status', authenticate, isAdmin, userController.updateUserStatus);
router.patch('/:id/role', authenticate, isAdmin, userController.updateUserRole);
router.patch('/:id/balance', authenticate, isAdmin, userController.adjustUserBalance);

// Ban / warn (Admin only)
router.post('/:id/ban', authenticate, isAdmin, adminController.banUser);
router.post('/:id/unban', authenticate, isAdmin, adminController.unbanUser);
router.get('/:id/warning-email/preview', authenticate, isAdmin, adminController.previewWarningEmail);
router.post('/:id/warning-email', authenticate, isAdmin, adminController.sendWarningEmail);

module.exports = router;