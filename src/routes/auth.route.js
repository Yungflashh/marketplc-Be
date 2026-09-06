const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { registerValidation, loginValidation, validate } = require('../middleware/validation.middeware');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit.middleware');

// ========================== PUBLIC ROUTES ==========================

// Register new user (sends OTP)
router.post('/register', authLimiter, registerValidation, validate, authController.register);

// Verify OTP after registration
router.post('/verify-otp', otpLimiter, authController.verifyOTP);

// Resend OTP if expired or not received
router.post('/resend-otp', otpLimiter, authController.resendOTP);

// Login (only allowed after OTP verification)
router.post('/login', authLimiter, loginValidation, validate, authController.login);

// Promote user to admin (secured with secret key)
router.post('/promote-admin', authController.promoteToAdmin);

// Forgot / reset password
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);

// ========================== PROTECTED ROUTES ==========================

// Get current authenticated user
router.get('/me', authenticate, authController.getCurrentUser);

// Update profile (name)
router.patch('/update-profile', authenticate, authController.updateProfile);

// Change password
router.patch('/change-password', authenticate, authController.changePassword);

// Acknowledge welcome bonus (dismiss celebration banner)
router.post('/acknowledge-welcome-bonus', authenticate, authController.acknowledgeWelcomeBonus);

// Referral: get my code + stats
router.get('/referral', authenticate, authController.getReferralInfo);

// Change email (OTP-gated)
router.post('/change-email/request', authenticate, authController.requestEmailChange);
router.post('/change-email/confirm', authenticate, authController.confirmEmailChange);

module.exports = router;
