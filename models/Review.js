const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' }
}, { timestamps: true });

// Prevent a student from leaving 50 reviews for the same kitchen
reviewSchema.index({ vendorId: 1, customerId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);