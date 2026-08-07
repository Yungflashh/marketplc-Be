const PaymentMethod = require('../models/PaymentMethod.model');

const DEFAULT_METHODS = [
  { label: 'USDT (TRC20)', type: 'crypto', address: 'TS4YcYuGH2kJpePVKAZGnpfVD4bN22sooE', network: 'TRC20', sortOrder: 1 },
  { label: 'USDT (ERC20)', type: 'crypto', address: '0x9A2c294d35F3123a4E48c82477801bFA3cb2f375', network: 'ERC20', sortOrder: 2 },
  { label: 'Ethereum', type: 'crypto', address: '0x9A2c294d35F3123a4E48c82477801bFA3cb2f375', network: 'ERC20', sortOrder: 3 },
  { label: 'BTC (Main)', type: 'crypto', address: 'bc1q7ecv238v9f2e6mr7srkwe4jswe0c28p6tw77zc', network: 'Bitcoin', sortOrder: 4 },
  { label: 'BTC (Secondary)', type: 'crypto', address: 'bc1qh2g93tgmk6h40p978r7s5wnmhn06fv726zyu3c', network: 'Bitcoin', sortOrder: 5 },
];

// Public: list active methods for the fund-wallet UI
exports.listActive = async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching payment methods', error: error.message });
  }
};

// Admin: list every method
exports.listAll = async (req, res) => {
  try {
    const methods = await PaymentMethod.find().sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching payment methods', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { label, type, address, network, instructions, isActive, sortOrder } = req.body;
    if (!label || !address) {
      return res.status(400).json({ success: false, message: 'label and address are required' });
    }
    const method = await PaymentMethod.create({ label, type, address, network, instructions, isActive, sortOrder });
    res.status(201).json({ success: true, message: 'Payment method created', data: method });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'A payment method with that label already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating payment method', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const method = await PaymentMethod.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!method) return res.status(404).json({ success: false, message: 'Payment method not found' });
    res.json({ success: true, message: 'Payment method updated', data: method });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'A payment method with that label already exists' });
    }
    res.status(500).json({ success: false, message: 'Error updating payment method', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const method = await PaymentMethod.findByIdAndDelete(req.params.id);
    if (!method) return res.status(404).json({ success: false, message: 'Payment method not found' });
    res.json({ success: true, message: 'Payment method deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting payment method', error: error.message });
  }
};

// Admin: seed the 5 legacy hardcoded methods (idempotent)
exports.seedDefaults = async (req, res) => {
  try {
    const created = [];
    const skipped = [];
    for (const m of DEFAULT_METHODS) {
      const exists = await PaymentMethod.findOne({ label: m.label });
      if (exists) {
        skipped.push(m.label);
        continue;
      }
      const doc = await PaymentMethod.create(m);
      created.push(doc.label);
    }
    res.json({
      success: true,
      message: `Seeded ${created.length} method(s), skipped ${skipped.length} existing`,
      data: { created, skipped },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error seeding defaults', error: error.message });
  }
};
