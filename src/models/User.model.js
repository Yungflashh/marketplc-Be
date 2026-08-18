const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  walletBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },

  // 🚫 Ban fields (temporary ban with expiry; distinct from isActive which is a hard deactivation)
  isBanned: {
    type: Boolean,
    default: false
  },
  banExpiresAt: {
    type: Date,
    default: null
  },
  banReason: {
    type: String,
    trim: true,
    default: ''
  },

  // ⚠️ Fraud/warning tracking
  failedTransactionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastWarningEmailAt: {
    type: Date,
    default: null
  },

  // 🔐 OTP fields
  otp: {
    type: String,
    select: false // don't return it in queries
  },
  otpExpires: {
    type: Date,
    select: false
  },
  isVerified: {
    type: Boolean,
    default: false
  }

}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};
// Generate OTP and save to DB immediately
userSchema.methods.generateOTP = async function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  this.otp = otp;
  this.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // ✅ store as Date object

  await this.save(); // 🔑 save to DB immediately
  return otp;
};

// Verify OTP and save changes
userSchema.methods.verifyOTP = async function(inputOTP) {
  const isValid =
    String(this.otp) === String(inputOTP) && // ✅ normalize type
    this.otpExpires &&
    this.otpExpires > new Date(); // ✅ compare with Date

  if (isValid) {
    this.isVerified = true;
    this.otp = undefined;
    this.otpExpires = undefined;
    await this.save(); // persist verification and clear OTP
  }

  return isValid;
};

// Hide password and otp fields from output
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.otp;
  delete obj.otpExpires;
  return obj;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
