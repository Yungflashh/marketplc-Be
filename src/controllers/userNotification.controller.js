const UserNotification = require('../models/UserNotification.model');

exports.list = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const filter = { user: req.user._id };
    if (unreadOnly === 'true') filter.read = false;

    const skip = (Number(page) - 1) * Number(limit);
    const [notifications, total, unreadCount] = await Promise.all([
      UserNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      UserNotification.countDocuments(filter),
      UserNotification.countDocuments({ user: req.user._id, read: false }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching notifications', error: error.message });
  }
};

exports.unreadCount = async (req, res) => {
  try {
    const count = await UserNotification.countDocuments({ user: req.user._id, read: false });
    res.json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching unread count', error: error.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    const notification = await UserNotification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, data: { notification } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error marking notification read', error: error.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await UserNotification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error marking all read', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const result = await UserNotification.deleteOne({ _id: req.params.id, user: req.user._id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error removing notification', error: error.message });
  }
};

exports.clearAll = async (req, res) => {
  try {
    await UserNotification.deleteMany({ user: req.user._id });
    res.json({ success: true, message: 'All notifications cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error clearing notifications', error: error.message });
  }
};
