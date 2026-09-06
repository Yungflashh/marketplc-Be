const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'order_status',
  'funding_approved',
  'funding_rejected',
  'welcome_bonus',
  'referral_reward',
  'wishlist_restock',
  'admin_message',
  'system',
];

const userNotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

userNotificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('UserNotification', userNotificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
