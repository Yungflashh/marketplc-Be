const Order = require('../models/Order.model');
const Product = require('../models/Product.model');
const User = require('../models/User.model');
const Transaction = require('../models/Transaction.model');
const { notify, escapeHtml } = require('../utils/telegram');
const { createUserNotification } = require('../utils/userNotify');

// Generate unique transaction reference
const generateReference = () => {
  return `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// Create order
exports.createOrder = async (req, res) => {
  try {
    const { items } = req.body; // items: [{ productId, quantity }]

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item'
      });
    }

    const user = await User.findById(req.user._id);
    const orderItems = [];
    let totalAmount = 0;

    // Process each item
    for (const item of items) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.productId}`
        });
      }

      if (!product.isActive) {
        return res.status(400).json({
          success: false,
          message: `Product is not available: ${product.name}`
        });
      }

      if (product.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.quantity}`
        });
      }

      const subtotal = product.price * item.quantity;
      totalAmount += subtotal;

      orderItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        price: product.price,
        subtotal
      });
    }

    // Check wallet balance
    if (user.walletBalance < totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
        data: {
          required: totalAmount,
          available: user.walletBalance,
          shortfall: totalAmount - user.walletBalance
        }
      });
    }

    // Create order using constructor + save (ensures pre-save hook sets orderNumber)
    const order = new Order({
      user: user._id,
      items: orderItems,
      totalAmount,
    });

    await order.save(); // Triggers pre-save hook to generate orderNumber

    // Deduct from wallet
    const balanceBefore = user.walletBalance;
    user.walletBalance -= totalAmount;
    await user.save();

    // Create transaction record
    await Transaction.create({
      user: user._id,
      type: 'debit',
      amount: totalAmount,
      description: `Order payment - ${order.orderNumber}`,
      balanceBefore,
      balanceAfter: user.walletBalance,
      reference: generateReference(),
      status: 'completed',
      relatedOrder: order._id
    });

    // Update product quantities
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { quantity: -item.quantity }
      });
    }

    // Populate order for response
    const populatedOrder = await Order.findById(order._id)
      .populate('user', 'name email')
      .populate('items.product', 'name imageUrl');

    notify(`🧾 <b>New order</b>\n#${order.orderNumber}\n${escapeHtml(user.name)} · ${orderItems.length} item(s) · <b>$${totalAmount.toFixed(2)}</b>`);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: { order: populatedOrder }
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: error.message
    });
  }
};


// Get user orders
exports.getUserOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const filter = { user: req.user._id };
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;

    const orders = await Order.find(filter)
      .populate('items.product', 'name imageUrl')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip);

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};

// Get single order
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email')
      .populate('items.product', 'name imageUrl');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user owns the order or is admin
    if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { order }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message
    });
  }
};

// Update order status (Admin only)
const ORDER_STATUSES = ['pending', 'in-review', 'processing', 'completed', 'cancelled'];

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${ORDER_STATUSES.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Order is already ${order.status} and cannot be updated`
      });
    }

    const oldStatus = order.status;
    order.status = status;
    await order.save();

    const populated = await Order.findById(order._id)
      .populate('user', 'name email')
      .populate('items.product', 'name imageUrl');

    notify(`📦 <b>Order status</b>\n#${order.orderNumber}: ${escapeHtml(oldStatus)} → <b>${escapeHtml(status)}</b>`);

    createUserNotification({
      userId: order.user,
      type: 'order_status',
      title: `Order #${order.orderNumber} is now ${status}`,
      body: `Your order has moved from ${oldStatus} to ${status}.`,
      link: `/order/${order._id}`,
    });

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      data: { order: populated }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
};

// Get all orders (Admin only)
exports.getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;

    const orders = await Order.find(filter)
      .populate('user', 'name email')
      .populate('items.product', 'name imageUrl')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip);

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};