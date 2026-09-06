const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// User routes
router.post('/', authenticate, orderController.createOrder);
router.get('/my-orders', authenticate, orderController.getUserOrders);
router.get('/:id', authenticate, orderController.getOrderById);

// Admin routes
router.get('/', authenticate, isAdmin, orderController.getAllOrders);
router.patch('/:id/status', authenticate, isAdmin, orderController.updateOrderStatus);

module.exports = router;