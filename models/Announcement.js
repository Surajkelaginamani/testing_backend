const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
  type: { type: String, default: 'General' },
  text: { type: String, required: true },
  
  // 🚨 THE MAGIC FIELD 🚨
  expiresAt: { type: Date, required: true } 
  
}, { timestamps: true });

// 🚨 THE TTL INDEX 🚨
// This tells MongoDB: "Watch the expiresAt field. The moment the current time passes that date, delete this entire document permanently."
announcementSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Announcement', announcementSchema);