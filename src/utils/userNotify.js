const UserNotification = require('../models/UserNotification.model');

// Fire-and-forget notification creator. Never throws.
// Use this inside controllers when something happens that a user should see
// in their bell dropdown / inbox.
exports.createUserNotification = ({ userId, type, title, body = '', link = '' }) => {
  if (!userId || !type || !title) return;
  UserNotification.create({ user: userId, type, title, body, link }).catch((err) => {
    console.warn('[userNotify] createNotification failed:', err.message);
  });
};
