const Cart = require('../models/Cart.model');
const Product = require('../models/Product.model');
const { notify, escapeHtml } = require('../utils/telegram');

const populatedCart = (userId) =>
  Cart.findOne({ user: userId }).populate('items.product');

const ensureCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
};

const serializeCart = (cart) => {
  if (!cart) return { items: [] };
  const items = (cart.items || [])
    .filter((i) => i.product && i.product.isActive !== false)
    .map((i) => ({
      product: i.product,
      quantity: i.quantity,
    }));
  return { _id: cart._id, items, updatedAt: cart.updatedAt };
};

exports.getCart = async (req, res) => {
  try {
    await ensureCart(req.user._id);
    const cart = await populatedCart(req.user._id);
    res.json({ success: true, data: { cart: serializeCart(cart) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching cart', error: error.message });
  }
};

exports.addItem = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required' });
    }
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: 'Product not available' });
    }

    const cart = await ensureCart(req.user._id);
    const existing = cart.items.find((i) => i.product.toString() === productId);
    if (existing) {
      existing.quantity += qty;
    } else {
      cart.items.push({ product: productId, quantity: qty });
    }
    await cart.save();

    notify(`🛒 <b>Add to cart</b>\n${escapeHtml(req.user.name)}: ${qty}× ${escapeHtml(product.name)} · $${product.price.toFixed(2)}`);

    const fresh = await populatedCart(req.user._id);
    res.json({ success: true, data: { cart: serializeCart(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error adding item', error: error.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;
    const qty = Math.floor(Number(quantity));

    if (!Number.isFinite(qty) || qty < 0) {
      return res.status(400).json({ success: false, message: 'quantity must be a non-negative integer' });
    }

    const cart = await ensureCart(req.user._id);
    const item = cart.items.find((i) => i.product.toString() === productId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not in cart' });
    }

    if (qty === 0) {
      cart.items = cart.items.filter((i) => i.product.toString() !== productId);
    } else {
      item.quantity = qty;
    }
    await cart.save();

    const fresh = await populatedCart(req.user._id);
    res.json({ success: true, data: { cart: serializeCart(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating item', error: error.message });
  }
};

exports.removeItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const cart = await ensureCart(req.user._id);
    cart.items = cart.items.filter((i) => i.product.toString() !== productId);
    await cart.save();

    const fresh = await populatedCart(req.user._id);
    res.json({ success: true, data: { cart: serializeCart(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error removing item', error: error.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const cart = await ensureCart(req.user._id);
    cart.items = [];
    await cart.save();
    res.json({ success: true, data: { cart: serializeCart(cart) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error clearing cart', error: error.message });
  }
};

// Merge a guest cart (from localStorage) into the user's server cart.
// For each incoming item: add if missing, sum quantities if present.
exports.mergeCart = async (req, res) => {
  try {
    const { items = [] } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'items must be an array' });
    }

    const cart = await ensureCart(req.user._id);

    // Validate + normalize incoming items against real products in one query
    const productIds = [...new Set(items.map((i) => i && i.productId).filter(Boolean))];
    const validProducts = await Product.find({ _id: { $in: productIds }, isActive: true }).select('_id');
    const validSet = new Set(validProducts.map((p) => p._id.toString()));

    for (const raw of items) {
      const productId = raw && raw.productId;
      const qty = Math.max(1, Math.floor(Number(raw && raw.quantity) || 1));
      if (!productId || !validSet.has(productId.toString())) continue;

      const existing = cart.items.find((i) => i.product.toString() === productId.toString());
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.items.push({ product: productId, quantity: qty });
      }
    }
    await cart.save();

    const fresh = await populatedCart(req.user._id);
    res.json({ success: true, data: { cart: serializeCart(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error merging cart', error: error.message });
  }
};
