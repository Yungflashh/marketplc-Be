const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportChat', required: true, index: true },
    sender: { type: String, enum: ['visitor', 'admin'], required: true },
    text: { type: String, required: true },
    // Set only for messages we sent TO Telegram (i.e. visitor messages we forwarded).
    // Used to look up the correct chat when an admin long-press-replies in Telegram.
    telegramMessageId: { type: Number, default: null, index: true, sparse: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
