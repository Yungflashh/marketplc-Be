const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const { sendEmail } = require('../utils/email');
const { welcomeEmail } = require('../emails/welcomeEmail');
const { loginAlertEmail } = require('../emails/loginAlertEmail');
const { otpEmail } = require('../emails/otpEmail');
const { forgotPasswordEmail } = require('../emails/forgotPasswordEmail');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// ========================== REGISTER ==========================
exports.register = async (req, res) => {

  console.log("trying to login");
  
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const user = await User.create({ name, email, password, role: role || 'user' });

    // Generate OTP for verification
   const otp = await user.generateOTP(); // single call handles saving

    // Send OTP email
    await sendEmail(user.email, 'Verify Your Email - ShopLogsHere', otpEmail(otp));

    console.log(otp);
    

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your email with the OTP sent.',
      data: {
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
};

// ========================== VERIFY OTP ==========================
exports.verifyOTP = async (req, res) => {

  console.log("It got here ooo");
  
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select('+otp +otpExpires');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValid = await user.verifyOTP(otp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    await user.save();

    // Send welcome email after successful verification
    await sendEmail(user.email, 'Welcome to ShopWithLogsHere 🎉', welcomeEmail(user.name));

    res.json({
      success: true,
      message: 'OTP verified successfully. You can now log in.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: error.message
    });
  }
};

// ========================== RESEND OTP ==========================
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: 'User already verified' });
    }

    const otp = await user.generateOTP(); // single call handles saving


    await sendEmail(email, 'Your New OTP Code', otpEmail(otp));

    res.json({ success: true, message: 'OTP resent successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error resending OTP',
      error: error.message
    });
  }
};

// ========================== LOGIN ==========================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+otp +otpExpires');

    // Generic 401 only when the account truly doesn't exist — avoids leaking
    // which emails are registered while still guiding real users.
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Verify-first: if the account isn't verified, always route the user to
    // /verify-otp regardless of whether they typed the right password. This
    // prevents the "wrong password"/"unverified" ambiguity that causes users
    // to re-register.
    if (!user.isVerified) {
      const hasValidOtp = user.otp && user.otpExpires && user.otpExpires > new Date();
      if (!hasValidOtp) {
        const otp = await user.generateOTP();
        await sendEmail(user.email, 'Verify Your Email - ShopLogsHere', otpEmail(otp));
      }
      return res.status(403).json({
        success: false,
        message: 'Account not verified — please check your email for the verification code.'
      });
    }

    // Now check password for verified accounts.
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const token = generateToken(user._id);

    // Send login alert email (non-blocking — don't fail the login if email breaks)
    sendEmail(user.email, 'New Login Detected', loginAlertEmail(user.name)).catch(() => {});

    res.json({
      success: true,
      message: 'Login successful',
      data: { user, token }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
};

// ========================== CURRENT USER ==========================
exports.getCurrentUser = async (req, res) => {
  try {
    res.json({
      success: true,
      data: { user: req.user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting user data',
      error: error.message
    });
  }
};

// ========================== FORGOT PASSWORD ==========================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ success: true, message: 'If an account exists with that email, a reset code has been sent.' });
    }

    const otp = await user.generateOTP();
    await sendEmail(email, 'Reset Your Password — ShopLogs', forgotPasswordEmail(user.name, otp));

    res.json({ success: true, message: 'Password reset code sent to your email.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error sending reset email', error: error.message });
  }
};

// ========================== RESET PASSWORD ==========================
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email }).select('+otp +otpExpires');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValid = await user.verifyOTP(otp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error resetting password', error: error.message });
  }
};

// ========================== UPDATE PROFILE ==========================
exports.updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name: name.trim() },
      { new: true }
    ).select('-password');
    res.json({ success: true, message: 'Profile updated successfully', data: { user } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating profile', error: error.message });
  }
};

// ========================== CHANGE PASSWORD ==========================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error changing password', error: error.message });
  }
};

// ========================== PROMOTE TO ADMIN ==========================
exports.promoteToAdmin = async (req, res) => {
  try {
    const { email, secret } = req.body;

    if (secret !== 'shoplogsadmin2026') {
      return res.status(403).json({ success: false, message: 'Invalid secret' });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { role: 'admin', isVerified: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      message: `${email} promoted to admin successfully`,
      data: { name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error promoting user', error: error.message });
  }
};
