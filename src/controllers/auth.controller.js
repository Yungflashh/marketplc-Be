const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const Transaction = require('../models/Transaction.model');
const Order = require('../models/Order.model');
const { sendEmail } = require('../utils/email');
const { welcomeEmail } = require('../emails/welcomeEmail');
const { loginAlertEmail } = require('../emails/loginAlertEmail');
const { otpEmail } = require('../emails/otpEmail');
const { forgotPasswordEmail } = require('../emails/forgotPasswordEmail');
const { notify, escapeHtml } = require('../utils/telegram');
const { createUserNotification } = require('../utils/userNotify');
const { extract, renderBlock, deviceFingerprint } = require('../utils/requestContext');
const failedLogin = require('../utils/failedLoginTracker');

const WELCOME_BONUS_AMOUNT = Number(process.env.WELCOME_BONUS_AMOUNT) || 5;
const REFERRAL_REWARD_AMOUNT = Number(process.env.REFERRAL_REWARD_AMOUNT) || 5;

const awardWelcomeBonus = async (user) => {
  if (user.welcomeBonusAwardedAt) return;
  const balanceBefore = user.walletBalance || 0;
  user.walletBalance = balanceBefore + WELCOME_BONUS_AMOUNT;
  user.welcomeBonusAwardedAt = new Date();
  await user.save();

  await Transaction.create({
    user: user._id,
    type: 'credit',
    amount: WELCOME_BONUS_AMOUNT,
    description: 'Welcome bonus 🎉',
    status: 'completed',
    paymentMethod: 'wallet',
    reference: `WELCOME-${user._id}-${Date.now()}`,
    balanceBefore,
    balanceAfter: user.walletBalance,
  });
};

// Credit the referrer + notify. Idempotency is guaranteed by the fact that
// awardWelcomeBonus itself is idempotent — we call this AFTER awardWelcomeBonus
// runs successfully so it only fires on the first verification.
const awardReferralReward = async (newUser) => {
  if (!newUser.referredBy) return;
  const referrer = await User.findById(newUser.referredBy);
  if (!referrer) return;

  const balanceBefore = referrer.walletBalance || 0;
  referrer.walletBalance = balanceBefore + REFERRAL_REWARD_AMOUNT;
  referrer.referralRewardCount = (referrer.referralRewardCount || 0) + 1;
  await referrer.save();

  await Transaction.create({
    user: referrer._id,
    type: 'credit',
    amount: REFERRAL_REWARD_AMOUNT,
    description: `Referral reward — ${newUser.email} joined`,
    status: 'completed',
    paymentMethod: 'wallet',
    reference: `REFERRAL-${referrer._id}-${newUser._id}-${Date.now()}`,
    balanceBefore,
    balanceAfter: referrer.walletBalance,
  });

  createUserNotification({
    userId: referrer._id,
    type: 'referral_reward',
    title: `You earned $${REFERRAL_REWARD_AMOUNT} from a referral!`,
    body: `${newUser.name} joined using your code. Bonus credited to your wallet.`,
    link: '/wallet',
  });

  notify(
    `🤝 <b>Referral reward</b>\n` +
      `${escapeHtml(referrer.name)} earned $${REFERRAL_REWARD_AMOUNT}\n` +
      `Invitee: ${escapeHtml(newUser.email)}\n` +
      `Total referrals: <b>${referrer.referralRewardCount}</b> · New balance: $${referrer.walletBalance.toFixed(2)}`
  );
};

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
    const { name, email, password, role, referralCode } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // If a referral code was supplied, look up the referrer (case-insensitive)
    let referredBy = null;
    let referrerNameForNote = null;
    if (referralCode && typeof referralCode === 'string') {
      const referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase() }).select('_id email name');
      if (referrer && referrer.email !== email) {
        referredBy = referrer._id;
        referrerNameForNote = referrer.name;
      }
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'user',
      referredBy,
    });

    // Generate OTP for verification
   const otp = await user.generateOTP(); // single call handles saving

    // Send OTP email
    await sendEmail(user.email, 'Verify Your Email - ShopLogsHere', otpEmail(otp));

    console.log(otp);

    const ctx = extract(req);
    const ctxBlock = renderBlock(ctx);
    notify(
      `🆕 <b>Signup started</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
        (referrerNameForNote ? `Referred by: <b>${escapeHtml(referrerNameForNote)}</b>\n` : '') +
        (ctxBlock ? `\n${ctxBlock}\n` : '') +
        `\n<i>Waiting for OTP verification…</i>`
    );

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
      const misses = failedLogin.bump('otp', email);
      if (misses >= 3) {
        notify(
          `❌ <b>OTP failures</b>\n${escapeHtml(email)}\n<b>${misses}</b> wrong codes in a row.`,
          { severity: 'warn' }
        );
      }
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    failedLogin.reset('otp', email);
    failedLogin.reset('otpResend', email);
    await user.save();

    // First-time verification → grant welcome bonus (idempotent)
    const isFirstVerification = !user.welcomeBonusAwardedAt;
    try {
      await awardWelcomeBonus(user);
    } catch (bonusErr) {
      console.error('Welcome bonus award failed:', bonusErr);
    }

    // Only award the referrer on the FIRST verification (prevents double-credit
    // if verifyOTP somehow runs twice).
    if (isFirstVerification && user.referredBy) {
      try {
        await awardReferralReward(user);
      } catch (referralErr) {
        console.error('Referral reward failed:', referralErr);
      }
    }

    const ctx = extract(req);
    const ctxBlock = renderBlock(ctx);
    notify(
      `✅ <b>Signup verified</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
        `$${WELCOME_BONUS_AMOUNT} welcome bonus credited.` +
        (ctxBlock ? `\n\n${ctxBlock}` : '')
    );

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

// ========================== REFERRAL: MY CODE + STATS ==========================
exports.getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('referralCode referralRewardCount');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Ensure the referral code exists (auto-generates on save via pre-save hook)
    if (!user.referralCode) {
      await user.save();
    }
    const referralsCount = await User.countDocuments({ referredBy: user._id });
    res.json({
      success: true,
      data: {
        referralCode: user.referralCode,
        referralsCount,
        rewardsEarned: user.referralRewardCount || 0,
        rewardAmount: REFERRAL_REWARD_AMOUNT,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching referral info', error: error.message });
  }
};

// ========================== CHANGE EMAIL: REQUEST ==========================
exports.requestEmailChange = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const trimmed = String(newEmail || '').trim().toLowerCase();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      return res.status(400).json({ success: false, message: 'A valid new email is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (trimmed === user.email) {
      return res.status(400).json({ success: false, message: 'This is already your email' });
    }

    const clash = await User.findOne({ email: trimmed }).select('_id').lean();
    if (clash) {
      return res.status(400).json({ success: false, message: 'That email is already in use' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.pendingEmail = trimmed;
    user.pendingEmailOtp = otp;
    user.pendingEmailOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendEmail(trimmed, 'Confirm your new ShopLogs email', otpEmail(otp));

    const ctx = extract(req);
    notify(
      `📧 <b>Email change requested</b>\n` +
        `${escapeHtml(user.name)}\n` +
        `Old: ${escapeHtml(user.email)}\n` +
        `New: ${escapeHtml(trimmed)}\n\n` +
        renderBlock(ctx),
      { severity: 'warn' }
    );

    res.json({
      success: true,
      message: 'A verification code was sent to your new email. Enter it to confirm the change.',
      data: { pendingEmail: trimmed },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error requesting email change', error: error.message });
  }
};

// ========================== CHANGE EMAIL: CONFIRM ==========================
exports.confirmEmailChange = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP is required' });
    }

    const user = await User.findById(req.user._id).select('+pendingEmailOtp +pendingEmailOtpExpires');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.pendingEmail || !user.pendingEmailOtp) {
      return res.status(400).json({ success: false, message: 'No email change is pending' });
    }
    if (String(user.pendingEmailOtp) !== String(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }
    if (!user.pendingEmailOtpExpires || user.pendingEmailOtpExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
    }

    // Re-check availability at the last moment
    const clash = await User.findOne({ email: user.pendingEmail }).select('_id').lean();
    if (clash) {
      user.pendingEmail = null;
      user.pendingEmailOtp = null;
      user.pendingEmailOtpExpires = null;
      await user.save();
      return res.status(400).json({ success: false, message: 'That email was taken while you waited' });
    }

    const oldEmail = user.email;
    user.email = user.pendingEmail;
    user.pendingEmail = null;
    user.pendingEmailOtp = null;
    user.pendingEmailOtpExpires = null;
    await user.save();

    notify(
      `✅ <b>Email changed</b>\n` +
        `${escapeHtml(user.name)}\n` +
        `${escapeHtml(oldEmail)} → <b>${escapeHtml(user.email)}</b>`
    );

    res.json({
      success: true,
      message: 'Email updated successfully',
      data: { user },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error confirming email change', error: error.message });
  }
};

// ========================== ACKNOWLEDGE WELCOME BONUS ==========================
exports.acknowledgeWelcomeBonus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.welcomeBonusAcknowledged) {
      user.welcomeBonusAcknowledged = true;
      await user.save();
    }
    res.json({ success: true, data: { user } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error acknowledging welcome bonus',
      error: error.message,
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

    const resendCount = failedLogin.bump('otpResend', email);
    if (resendCount >= 4) {
      notify(
        `♻️ <b>OTP resend spam</b>\n${escapeHtml(email)}\n<b>${resendCount}</b> resends in the last 15 min.`,
        { severity: 'warn' }
      );
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
    const ctx = extract(req);

    // Generic 401 only when the account truly doesn't exist — avoids leaking
    // which emails are registered while still guiding real users.
    if (!user) {
      const fails = failedLogin.bump('login', email || ctx.ip);
      if (fails >= 5) {
        notify(
          `🚫 <b>Failed logins</b>\n` +
            `Email: ${escapeHtml(email || '(none)')}\n` +
            `<b>${fails}</b> attempts in 15 min.\n\n` +
            renderBlock(ctx),
          { severity: 'alert' }
        );
      }
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
      const fails = failedLogin.bump('login', user.email);
      if (fails >= 3) {
        notify(
          `🔓 <b>Wrong password</b>\n` +
            `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
            `<b>${fails}</b> failed attempts in a row.\n\n` +
            renderBlock(ctx),
          { severity: 'warn' }
        );
      }
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    if (user.isBanned) {
      if (user.banExpiresAt && user.banExpiresAt <= new Date()) {
        user.isBanned = false;
        user.banExpiresAt = null;
        user.banReason = '';
        await user.save();
      } else {
        return res.status(403).json({
          success: false,
          message: user.banReason
            ? `Your account is banned: ${user.banReason}`
            : 'Your account is banned.',
          banExpiresAt: user.banExpiresAt,
        });
      }
    }

    const priorFailCount = failedLogin.peek('login', user.email);
    failedLogin.reset('login', user.email);

    // Detect new device / new country BEFORE mutating user record
    const fingerprint = deviceFingerprint(req);
    const knownDevices = user.knownDeviceHashes || [];
    const isNewDevice = !knownDevices.includes(fingerprint);
    const currentCountry = ctx.geo?.country || '';
    const isNewCountry = currentCountry && user.lastLoginCountry && currentCountry !== user.lastLoginCountry;

    // Update login tracking
    user.lastLoginAt = new Date();
    user.lastLoginIp = ctx.ip;
    user.lastLoginCountry = currentCountry || user.lastLoginCountry;
    if (isNewDevice && fingerprint) {
      // Keep list bounded — most recent 20 devices
      user.knownDeviceHashes = [fingerprint, ...knownDevices].slice(0, 20);
    }
    await user.save();

    const token = generateToken(user._id);

    const ctxBlock = renderBlock(ctx);
    const flags = [];
    if (isNewDevice) flags.push('🆕 new device');
    if (isNewCountry) flags.push(`🌍 new country (was ${escapeHtml(user.lastLoginCountry || 'unknown')})`);
    if (priorFailCount > 0) flags.push(`⚠️ succeeded after ${priorFailCount} failed attempt(s)`);
    const flagLine = flags.length ? `\n${flags.join(' · ')}` : '';

    const severity = isNewCountry || priorFailCount >= 3 ? 'warn' : 'info';
    notify(
      `🔑 <b>Login</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;` +
        flagLine +
        (ctxBlock ? `\n\n${ctxBlock}` : ''),
      { severity }
    );

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

    const ctx = extract(req);
    notify(
      `🔐 <b>Password reset requested</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n\n` +
        renderBlock(ctx),
      { severity: 'warn' }
    );

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
      const misses = failedLogin.bump('otp', email);
      if (misses >= 3) {
        notify(
          `❌ <b>OTP failures (reset)</b>\n${escapeHtml(email)}\n<b>${misses}</b> wrong codes.`,
          { severity: 'warn' }
        );
      }
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });
    }

    failedLogin.reset('otp', email);
    user.password = newPassword;
    await user.save();

    const ctx = extract(req);
    notify(
      `✅ <b>Password reset completed</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n\n` +
        renderBlock(ctx)
    );

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error resetting password', error: error.message });
  }
};

// ========================== UPDATE PROFILE ==========================
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
      }
      updates.name = name.trim();
    }
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (address !== undefined) updates.address = String(address).trim();

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const before = await User.findById(req.user._id).select('name phone address');
    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true }
    ).select('-password');

    // Detect what actually changed for the Telegram note
    const changedFields = [];
    if (updates.name && updates.name !== before.name) changedFields.push(`name`);
    if (updates.phone !== undefined && updates.phone !== (before.phone || '')) changedFields.push(`phone`);
    if (updates.address !== undefined && updates.address !== (before.address || '')) changedFields.push(`address`);

    // Detect first-time profile completion (address + phone set for the first time)
    const nowHasBoth = user.phone && user.address;
    const hadBoth = before.phone && before.address;
    if (nowHasBoth && !hadBoth) {
      notify(
        `🎯 <b>Profile completed</b>\n` +
          `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
          `📞 ${escapeHtml(user.phone)}\n` +
          `📍 ${escapeHtml(user.address)}`
      );
    } else if (changedFields.length) {
      notify(
        `📝 <b>Profile updated</b>\n` +
          `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n` +
          `Changed: ${escapeHtml(changedFields.join(', '))}`
      );
    }

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

    const ctx = extract(req);
    notify(
      `🔑 <b>Password changed</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;\n\n` +
        renderBlock(ctx),
      { severity: 'warn' }
    );

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

    notify(
      `👑 <b>Promoted to admin</b>\n` +
        `${escapeHtml(user.name)} &lt;${escapeHtml(user.email)}&gt;`,
      { severity: 'alert' }
    );

    res.json({
      success: true,
      message: `${email} promoted to admin successfully`,
      data: { name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error promoting user', error: error.message });
  }
};
