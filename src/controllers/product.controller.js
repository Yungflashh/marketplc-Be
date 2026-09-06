const Product = require('../models/Product.model');
const cloudinary = require('../config/cloudinary');
const { notify, escapeHtml } = require('../utils/telegram');

const LOW_STOCK_THRESHOLD = 3;
const ADMIN_BASE = process.env.ADMIN_BASE_URL || '';

// Create new product (Admin only)

exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, quantity, category } = req.body;

    let imageUrl = null;

    // Upload image if provided
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        folder: 'products',
      });
      imageUrl = uploaded.secure_url;
    }

    const product = await Product.create({
      name,
      description,
      price,
      quantity,
      category,
      imageUrl,
      createdBy: req.user._id,
    });

    notify(
      `🆕 <b>Product created</b>\n` +
        `${escapeHtml(product.name)} · $${Number(product.price).toFixed(2)}\n` +
        `Stock: ${product.quantity} · Category: ${escapeHtml(product.category || '—')}\n` +
        `By: ${escapeHtml(req.user.name)}`
    );

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: error.message,
    });
  }
};
;

// Get all products
exports.getAllProducts = async (req, res) => {
  try {
    const { category, minPrice, maxPrice, search, page = 1, limit = 10 } = req.query;

    // Build filter
    const filter = { isActive: true };

    if (category) {
      filter.category = category;
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (page - 1) * limit;

    const products = await Product.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(skip);

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: {
        products,
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
      message: 'Error fetching products',
      error: error.message
    });
  }
};

// Get single product
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: { product }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
};

// Update product (Admin only)
exports.updateProduct = async (req, res) => {
  try {
    const { name, description, price, quantity, category, isActive } = req.body;

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Capture pre-update snapshot for diff notification
    const before = {
      name: product.name,
      price: product.price,
      quantity: product.quantity,
      category: product.category,
      isActive: product.isActive,
    };

    // Upload new image if provided
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, {
        folder: 'products',
      });
      product.imageUrl = uploaded.secure_url;
    }

    // Update fields
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = Number(price);
    if (quantity !== undefined) product.quantity = Number(quantity);
    if (category !== undefined) product.category = category;
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();

    // Build diff for notification
    const changes = [];
    if (before.name !== product.name) changes.push(`name: ${escapeHtml(before.name)} → ${escapeHtml(product.name)}`);
    if (before.price !== product.price) {
      const delta = product.price - before.price;
      const arrow = delta > 0 ? '⬆️' : '⬇️';
      changes.push(`price: $${before.price.toFixed(2)} → $${product.price.toFixed(2)} ${arrow}`);
    }
    if (before.quantity !== product.quantity) {
      const restocked = product.quantity > before.quantity ? ' ↑' : '';
      changes.push(`stock: ${before.quantity} → ${product.quantity}${restocked}`);
    }
    if (before.category !== product.category) changes.push(`category: ${escapeHtml(before.category || '—')} → ${escapeHtml(product.category || '—')}`);
    if (before.isActive !== product.isActive) changes.push(`active: ${before.isActive} → ${product.isActive}`);
    if (req.file) changes.push('image replaced');

    if (changes.length) {
      const isPriceChange = before.price !== product.price;
      notify(
        `✏️ <b>Product updated</b>\n` +
          `${escapeHtml(product.name)}\n` +
          changes.map((c) => `• ${c}`).join('\n') +
          `\nBy: ${escapeHtml(req.user.name)}`,
        { severity: isPriceChange ? 'warn' : 'info' }
      );
    }

    // Low-stock alert
    if (product.isActive && product.quantity <= LOW_STOCK_THRESHOLD && before.quantity > LOW_STOCK_THRESHOLD) {
      notify(
        `📉 <b>Low stock</b>\n${escapeHtml(product.name)} · <b>${product.quantity}</b> left`,
        { severity: 'warn' }
      );
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message,
    });
  }
};

// Delete product (Admin only)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const snapshot = { name: product.name, price: product.price };
    await product.deleteOne();

    notify(
      `🗑️ <b>Product deleted</b>\n` +
        `${escapeHtml(snapshot.name)} · $${Number(snapshot.price).toFixed(2)}\n` +
        `By: ${escapeHtml(req.user.name)}`,
      { severity: 'warn' }
    );

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
};

// Get featured products (public)
exports.getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true, featured: true })
      .sort({ updatedAt: -1 })
      .limit(12);
    res.json({ success: true, data: { products } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching featured products', error: error.message });
  }
};

// Get new arrivals (public)
exports.getNewArrivals = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(12);
    res.json({ success: true, data: { products } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching new arrivals', error: error.message });
  }
};

// Toggle featured flag (Admin only)
exports.toggleFeatured = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    product.featured = !product.featured;
    await product.save();
    notify(
      `⭐ <b>Product ${product.featured ? 'featured' : 'unfeatured'}</b>\n${escapeHtml(product.name)}`
    );
    res.json({ success: true, message: `Product ${product.featured ? 'marked as featured' : 'removed from featured'}`, data: { product } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error toggling featured', error: error.message });
  }
};

// Get product categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct('category', { isActive: true });

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
};