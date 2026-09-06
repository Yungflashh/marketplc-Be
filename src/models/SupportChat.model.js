const mongoose = require('mongoose');

const supportChatSchema = new mongoose.Schema(
  {
    // Anonymous visitors get a UUID persisted in localStorage; logged-in users
    // get their user._id also attached. sessionId is always present.
    sessionId: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    visitorName: { type: String, default: '' },
    visitorEmail: { type: String, default: '' },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    unreadForAdmin: { type: Number, default: 0 },
    unreadForVisitor: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportChat', supportChatSchema);
