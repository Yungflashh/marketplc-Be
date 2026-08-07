const mongoose = require('mongoose');

const PaymentMethodSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, unique: true, trim: true },
    type: {
      type: String,
      enum: ['crypto', 'paypal', 'cashapp', 'zelle', 'bank', 'other'],
      default: 'crypto',
    },
    address: { type: String, required: true, trim: true },
    network: { type: String, trim: true, default: '' },
    instructions: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentMethod', PaymentMethodSchema);
