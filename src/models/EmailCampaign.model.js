const mongoose = require('mongoose');

const sendResultSchema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String },
  },
  { _id: false }
);

const recipientConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['all', 'segment', 'individual', 'external'],
      required: true,
    },
    filters: {
      role: { type: String, enum: ['user', 'admin'] },
      isVerified: { type: Boolean },
      isActive: { type: Boolean },
      hasOrderedInLastDays: { type: Number },
      hasNotOrderedInLastDays: { type: Number },
    },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    externalEmails: [{ type: String, lowercase: true, trim: true }],
  },
  { _id: false }
);

const designSchema = new mongoose.Schema(
  {
    accentColor: { type: String, default: '#111827' },
    backgroundColor: { type: String, default: '#f9fafb' },
    textColor: { type: String, default: '#374151' },
    headerText: { type: String, default: 'ShopLogs' },
    layout: { type: String, enum: ['simple', 'branded', 'minimal'], default: 'branded' },
  },
  { _id: false }
);

const emailCampaignSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    recipients: { type: recipientConfigSchema, required: true },
    status: {
      type: String,
      enum: ['draft', 'sent', 'failed'],
      default: 'draft',
    },
    aiPrompt: { type: String },
    template: {
      type: String,
      enum: ['newsletter', 'promo', 'announcement', 'restock', 'thank-you', 'reengagement', 'custom'],
      default: 'custom',
    },
    design: { type: designSchema, default: () => ({}) },
    isDefault: { type: Boolean, default: false },
    defaultKey: { type: String },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sentAt: { type: Date },
    sendResults: {
      total: { type: Number, default: 0 },
      succeeded: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      details: [sendResultSchema],
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.EmailCampaign ||
  mongoose.model('EmailCampaign', emailCampaignSchema);
