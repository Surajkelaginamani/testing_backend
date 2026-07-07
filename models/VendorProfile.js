const mongoose = require('mongoose');

const vendorProfileSchema = new mongoose.Schema({
  // --- CORE IDENTITY ---
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerName: { type: String, required: true },
  businessName: { type: String, required: true },
  
  // --- BUSINESS DETAILS ---
  serviceArea: { type: String, default: '' }, // e.g., "Sanjivani Hostels"
  serviceType: { type: String, default: 'Tiffin Service' },
  foodType: { type: String, enum: ['Veg', 'Non-Veg', 'Mix'], default: 'Mix' },
  deliveryType: { type: String, default: 'Delivery' },

  // --- 🚨 NEW SMART CALENDAR PRICING 🚨 ---
  monthlyFullPrice: { type: Number, default: 0 }, // 30 Days, 2 Meals/Day
  monthlyHalfPrice: { type: Number, default: 0 }, // 30 Days, 1 Meal/Day
  weeklyPrice: { type: Number, default: 0 },      // 7 Days
  singleMealPrice: { type: Number, default: 0 },  // 1 Meal

  // --- 🚨 THE MASTER HOLIDAY POLICY TOGGLE 🚨 ---
  considersHolidays: { type: Boolean, default: false }, 

  // --- MENU & COMMUNICATION ---
  weeklyMenu: {
    type: Map,
    of: {
      lunch: { type: String, default: '' },
      dinner: { type: String, default: '' }
    },
    default: {}
  },

  // --- REVIEWS & RATING ---
  rating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },

  // --- ADMIN APPROVAL STATUS ---
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  approvalDate: { type: Date },
  rejectionReason: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('VendorProfile', vendorProfileSchema);