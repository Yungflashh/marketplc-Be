const express = require('express');
const router = express.Router();
const paymentMethodController = require('../controllers/paymentMethod.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// Public — powers the fund-wallet dropdown
router.get('/', paymentMethodController.listActive);

// Admin
router.get('/admin/all', authenticate, isAdmin, paymentMethodController.listAll);
router.post('/', authenticate, isAdmin, paymentMethodController.create);
router.put('/:id', authenticate, isAdmin, paymentMethodController.update);
router.delete('/:id', authenticate, isAdmin, paymentMethodController.remove);
router.post('/seed-defaults', authenticate, isAdmin, paymentMethodController.seedDefaults);

module.exports = router;
