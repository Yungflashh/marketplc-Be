const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth.route');
const productRoutes = require('./routes/product.route');
const walletRoutes = require('./routes/wallet.route');
const orderRoutes = require('./routes/order.route');
const userRoutes = require('./routes/user.route');
const adminTransactions = require('./routes/transactions.route');
const adminNotifications = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.route');
const emailRoutes = require('./routes/email.route');
const paymentMethodRoutes = require('./routes/paymentMethod.route');
const cartRoutes = require('./routes/cart.route');
const wishlistRoutes = require('./routes/wishlist.route');
const supportRoutes = require('./routes/support.route');
const trackRoutes = require('./routes/track.route');
const inboxRoutes = require('./routes/userNotification.route');

const { notify, escapeHtml, isConfigured, formatTimestamp } = require('./utils/telegram');
const { extract, renderBlock } = require('./utils/requestContext');
const abandonmentJob = require('./jobs/abandonment.job');
const analyticsJob = require('./jobs/analytics.job');

const app = express();

// Trust the first proxy hop (Render, Vercel, etc.) so req.ip and rate limiters
// see the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Middleware
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'https://www.shoplogshere.com',
    'https://shoplogshere.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-API-Key',
  ],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => {
  console.error('MongoDB connection error:', err);
  notify(
    `💥 <b>MongoDB connection failed</b>\nError: ${escapeHtml(err.message)}`,
    { severity: 'alert' }
  );
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminTransactions);
app.use('/api/notifications', adminNotifications);
app.use('/api/chat', chatRoutes);
app.use('/api/admin/emails', emailRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/inbox', inboxRoutes);

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Debounce repeat 500s from the same route so a broken endpoint doesn't spam.
const recentErrorAlerts = new Map();
const ERROR_COOLDOWN_MS = 2 * 60 * 1000;
const shouldAlertError = (key) => {
  const last = recentErrorAlerts.get(key) || 0;
  if (Date.now() - last < ERROR_COOLDOWN_MS) return false;
  recentErrorAlerts.set(key, Date.now());
  return true;
};

// Error handling middleware — also forwards uncaught exceptions to Telegram
app.use((err, req, res, next) => {
  console.error(err.stack);
  try {
    const route = `${req.method} ${req.originalUrl || req.url || ''}`;
    if (shouldAlertError(route)) {
      const ctx = extract(req);
      const userLine = req.user
        ? `\nUser: ${escapeHtml(req.user.name || '')} &lt;${escapeHtml(req.user.email || '')}&gt;`
        : '';
      notify(
        `💥 <b>Uncaught server error</b>\n` +
          `<code>${escapeHtml(route)}</code>${userLine}\n\n` +
          `<b>${escapeHtml(err.message || 'unknown')}</b>\n` +
          `<pre>${escapeHtml(String(err.stack || '').slice(0, 400))}</pre>\n\n` +
          renderBlock(ctx),
        { severity: 'alert' }
      );
    }
  } catch (e) {
    console.warn('error-notify failed:', e.message);
  }
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// Also catch async errors thrown outside express context.
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  const msg = reason instanceof Error ? reason.message : String(reason);
  notify(
    `💥 <b>Unhandled promise rejection</b>\n${escapeHtml(msg).slice(0, 400)}`,
    { severity: 'alert' }
  );
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  notify(
    `💥 <b>Uncaught exception</b>\n${escapeHtml(err.message || String(err)).slice(0, 400)}`,
    { severity: 'alert' }
  );
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Bootstrap ping — confirms telegram is wired end-to-end on each deploy.
  if (isConfigured()) {
    notify(
      `🚀 <b>Server started</b>\n` +
        `Port: ${PORT}\n` +
        `Env: ${escapeHtml(process.env.NODE_ENV || 'production')}\n` +
        `Time: ${formatTimestamp()}`
    );
  }
  // Kick off scheduled jobs.
  abandonmentJob.start();
  analyticsJob.start();
});
