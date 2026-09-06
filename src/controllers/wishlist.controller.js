const Wishlist = require('../models/Wishlist.model');
const Product = require('../models/Product.model');

const populatedWishlist = (userId) =>
  Wishlist.findOne({ user: userId }).populate('items.product');

const ensureWishlist = async (userId) => {
  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) wishlist = await Wishlist.create({ user: userId, items: [] });
  return wishlist;
};

const serializeWishlist = (wishlist) => {
  if (!wishlist) return { items: [] };
  const items = (wishlist.items || [])
    .filter((i) => i.product && i.product.isActive !== false)
    .map((i) => ({
      product: i.product,
      addedAt: i.addedAt,
    }));
  return { _id: wishlist._id, items, updatedAt: wishlist.updatedAt };
};

exports.getWishlist = async (req, res) => {
  try {
    await ensureWishlist(req.user._id);
    const wishlist = await populatedWishlist(req.user._id);
    res.json({ success: true, data: { wishlist: serializeWishlist(wishlist) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching wishlist', error: error.message });
  }
};

exports.addItem = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required' });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: 'Product not available' });
    }

    const wishlist = await ensureWishlist(req.user._id);
    const alreadyIn = wishlist.items.some((i) => i.product.toString() === productId);
    if (!alreadyIn) {
      wishlist.items.push({ product: productId, addedAt: new Date() });
      await wishlist.save();
    }

    const fresh = await populatedWishlist(req.user._id);
    res.json({ success: true, data: { wishlist: serializeWishlist(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error adding item', error: error.message });
  }
};

exports.removeItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const wishlist = await ensureWishlist(req.user._id);
    wishlist.items = wishlist.items.filter((i) => i.product.toString() !== productId);
    await wishlist.save();

    const fresh = await populatedWishlist(req.user._id);
    res.json({ success: true, data: { wishlist: serializeWishlist(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error removing item', error: error.message });
  }
};

exports.clearWishlist = async (req, res) => {
  try {
    const wishlist = await ensureWishlist(req.user._id);
    wishlist.items = [];
    await wishlist.save();
    res.json({ success: true, data: { wishlist: serializeWishlist(wishlist) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error clearing wishlist', error: error.message });
  }
};

// Merge a guest wishlist (from localStorage) into the user's server wishlist.
// De-duplicates by productId.
exports.mergeWishlist = async (req, res) => {
  try {
    const { productIds = [] } = req.body;
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ success: false, message: 'productIds must be an array' });
    }

    const wishlist = await ensureWishlist(req.user._id);

    const validProducts = await Product.find({
      _id: { $in: productIds },
      isActive: true,
    }).select('_id');
    const validSet = new Set(validProducts.map((p) => p._id.toString()));
    const existing = new Set(wishlist.items.map((i) => i.product.toString()));

    for (const productId of productIds) {
      const id = productId?.toString();
      if (!id || !validSet.has(id) || existing.has(id)) continue;
      wishlist.items.push({ product: id, addedAt: new Date() });
      existing.add(id);
    }
    await wishlist.save();

    const fresh = await populatedWishlist(req.user._id);
    res.json({ success: true, data: { wishlist: serializeWishlist(fresh) } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error merging wishlist', error: error.message });
  }
};
