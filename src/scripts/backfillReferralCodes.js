/**
 * One-off backfill: assign a referralCode to any existing user that doesn't have one.
 *
 * Usage (from the mrk-Be project root):
 *   node src/scripts/backfillReferralCodes.js
 *
 * Idempotent — safe to run multiple times. Skips users who already have a code.
 * Relies on the User model's pre-save hook to generate the code + guarantee uniqueness.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User.model');

const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('✅ Connected.');

  const cursor = User.find({
    $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: '' }],
  }).cursor();

  let updated = 0;
  let failed = 0;
  let scanned = 0;

  for (let user = await cursor.next(); user != null; user = await cursor.next()) {
    scanned += 1;
    try {
      // Pre-save hook generates the code (retries on clash).
      await user.save();
      updated += 1;
      if (updated % 25 === 0) console.log(`  … ${updated} updated so far`);
    } catch (err) {
      failed += 1;
      console.warn(`  ⚠️  Failed for ${user.email}: ${err.message}`);
    }
  }

  console.log('---');
  console.log(`Scanned:  ${scanned}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Failed:   ${failed}`);
  console.log('---');

  await mongoose.disconnect();
  console.log('✅ Done. Disconnected.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
