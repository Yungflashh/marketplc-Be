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

const app = express();

// Middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'https://www.shoplogshere.com', 'https://shoplogshere.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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
.catch((err) => console.error('MongoDB connection error:', err));

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

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});