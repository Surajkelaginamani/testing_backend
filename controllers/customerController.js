const User = require('../models/User');
const Subscription = require('../models/Subscription');
const DailyMenu = require('../models/DailyMenu');
const Announcement = require('../models/Announcement');

const VendorHoliday = require('../models/VendorHoliday');

const HomemadeItem = require('../models/HomemadeItem');
const HomemadeOrder = require('../models/HomemadeOrder');
const HomemadeStockLog = require('../models/HomemadeStockLog');
const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const VendorProfile = require('../models/VendorProfile');

const normalizeDateKey = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  const dateKey = raw.includes('T') ? raw.slice(0, 10) : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
};

const parseDateKeyAsLocal = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const getWeekdayName = (date = new Date()) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
};

const buildTodaysMenuFromWeekly = (weeklyMenu) => {
  const dayName = getWeekdayName(new Date());
  const dayMenu = weeklyMenu?.[dayName] || {};
  const lunchItems = String(dayMenu.lunch || '').trim();
  const dinnerItems = String(dayMenu.dinner || '').trim();

  if (!lunchItems && !dinnerItems) return null;

  return {
    day: dayName,
    lunch: { time: '12:30 PM', items: lunchItems || 'No lunch menu set.' },
    dinner: dinnerItems ? { time: '8:00 PM', items: dinnerItems } : null
  };
};

const getPlanDurationDays = (planType) => {
  const type = String(planType || '').toLowerCase();
  if (type.includes('single')) return 1;
  if (type.includes('weekly') || type.includes('7_days')) return 7;
  if (type.includes('15_days')) return 15;
  return 30; // Default monthly duration
};

const getPlanSessionCount = (planType) => {
  const type = String(planType || '').toLowerCase();
  if (type.includes('full')) return 2;
  return 1;
};

const countSkippedTiffins = (skippedDates = [], until = new Date()) => {
  if (!Array.isArray(skippedDates)) return 0;
  return skippedDates.reduce((count, entry) => {
    if (!entry) return count;
    const dateString = entry.date || entry;
    const time = entry.time || 'full_day';
    const targetDate = parseDateKeyAsLocal(String(dateString));
    if (!targetDate || targetDate.getTime() > until.getTime()) return count;
    if (time === 'full_day') return count + 2;
    if (time === 'morning' || time === 'afternoon') return count + 1;
    return count + 1;
  }, 0);
};

const getTotalTiffins = (planType) => getPlanDurationDays(planType) * getPlanSessionCount(planType);

const defaultWeeklyMenu = () => ({
  Monday: { lunch: '', dinner: '' },
  Tuesday: { lunch: '', dinner: '' },
  Wednesday: { lunch: '', dinner: '' },
  Thursday: { lunch: '', dinner: '' },
  Friday: { lunch: '', dinner: '' },
  Saturday: { lunch: '', dinner: '' },
  Sunday: { lunch: '', dinner: '' }
});

const recomputeVendorRating = async (vendorId) => {
  const result = await Review.aggregate([
    { $match: { vendor: vendorId } },
    {
      $group: {
        _id: '$vendor',
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (!result.length) {
    await VendorProfile.findByIdAndUpdate(vendorId, { rating: 0, totalReviews: 0 });
    return;
  }

  const { averageRating, totalReviews } = result[0];
  await VendorProfile.findByIdAndUpdate(vendorId, {
    rating: Number(averageRating.toFixed(1)),
    totalReviews
  });
};

exports.getDailyDeliveryList = async (req, res) => {
  try {
    const vendorId = req.vendor.id; // From your auth middleware
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const todayDateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Normalize today for date comparisons
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // 1. Fetch all ACTIVE subscriptions for this vendor
    const allActiveSubs = await Subscription.find({ 
      vendorId: vendorId, 
      status: 'active' 
    }).populate('customerId', 'name phone location roomNumber');

    // 2. 🚨 THE FIX: The Time-Aware Filter 🚨
    const deliveriesToday = allActiveSubs.filter(sub => {
      // Rule A: Has the plan actually started yet?
      if (sub.startDate) {
        const start = new Date(sub.startDate);
        start.setHours(0, 0, 0, 0);
        if (start > todayMidnight) return false; // FUTURE PLAN: Ignore!
      }

      // Rule B: Has the plan already expired?
      if (sub.endDate) {
        const end = new Date(sub.endDate);
        end.setHours(0, 0, 0, 0);
        if (end < todayMidnight) return false; // EXPIRED PLAN: Ignore!
      }

      // Rule C: Did they mark a holiday for today?
      if (!sub.skippedDates || !Array.isArray(sub.skippedDates)) return true;
      return !sub.skippedDates.some(entry => entry?.date === todayDateString);
    });

    // 3. Smart Grouping
    const groupedDeliveries = deliveriesToday.reduce((acc, sub) => {
      if (!sub.customerId) return acc; 

      const location = sub.customerId.location || 'Unspecified Location';
      
      if (!acc[location]) {
        acc[location] = [];
      }
      
      acc[location].push({
        subscriptionId: sub._id,
        customerName: sub.customerId.name,
        roomNumber: sub.customerId.roomNumber || 'N/A',
        phone: sub.customerId.phone,
        planType: sub.planType,
        mealType: sub.mealType
      });
      
      return acc;
    }, {});

    res.status(200).json({ 
      date: todayDateString,
      totalDeliveries: deliveriesToday.length,
      groupedList: groupedDeliveries 
    });

  } catch (error) {
    console.error("Error fetching delivery list:", error);
    res.status(500).json({ error: "Server error fetching delivery list" });
  }
};
// GET PROFILE
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password'); 
    if (!user) return res.status(404).json({ error: "User not found" });
    
    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ error: "Server error fetching profile" });
  }
};

// UPDATE PROFILE
exports.updateProfile = async (req, res) => {
  try {
    // Extracting exactly what matches your schema
    const { name, phone, location, roomNumber } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { name, phone, location, roomNumber },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) return res.status(404).json({ error: "User not found" });

    res.status(200).json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "Server error updating profile" });
  }
};
exports.updateHolidays = async (req, res) => {
  try {
    const subscriptionId = req.params.id;
    const customerId = req.user.userId || req.user.id;
    const { skippedDates } = req.body;

    if (!Array.isArray(skippedDates)) {
      return res.status(400).json({ error: "skippedDates must be an array." });
    }

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      customer: customerId
    });

    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found for this customer." });
    }

    // 🚨 1. TWO-TIER HOLIDAY LOGIC FUNCTION 🚨
    const determineIfConsidered = (time) => {
      if (time === 'full_day' && subscription.vendorConsidersHolidays === true) {
        return true; // Vendor allows it, and it's a full day!
      }
      return false; // Half-days or strict vendors never extend the plan.
    };

    // Normalize incoming data and apply the Two-Tier Logic
    const normalizedHolidays = skippedDates.map(holiday => {
      if (typeof holiday === 'string') {
        return { 
          date: normalizeDateKey(holiday), 
          time: 'full_day',
          isConsideredForExtension: determineIfConsidered('full_day')
        };
      } else if (typeof holiday === 'object' && holiday.date) {
        const timeVal = holiday.time || 'full_day';
        return {
          date: normalizeDateKey(holiday.date),
          time: timeVal,
          isConsideredForExtension: determineIfConsidered(timeVal)
        };
      }
      return null;
    }).filter(Boolean);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const mergedHolidays = new Map();
    const holidayKey = (h) => `${h.date}`;

    const existingHolidays = Array.isArray(subscription.skippedDates)
      ? subscription.skippedDates.filter(Boolean)
      : [];

    // KEEP HISTORY (Past holidays)
    existingHolidays.forEach((holiday) => {
      if (!holiday || !holiday.date) return;
      const hDate = parseDateKeyAsLocal(holiday.date);
      if (hDate.getTime() < tomorrowStart.getTime()) {
        mergedHolidays.set(holidayKey(holiday), holiday); // Keep exactly as they were
      }
    });

    // OVERWRITE FUTURE with new validated array
    const ignoredDates = [];
    normalizedHolidays.forEach((holiday) => {
      if (!holiday || !holiday.date) return;
      const targetDate = parseDateKeyAsLocal(holiday.date);
      if (targetDate.getTime() >= tomorrowStart.getTime()) {
        mergedHolidays.set(holidayKey(holiday), holiday);
      } else {
        ignoredDates.push(holiday.date); 
      }
    });

    // Save the synced list!
    subscription.skippedDates = Array.from(mergedHolidays.values());

// 🚨 2. RECALCULATE THE END DATE 🚨
    const consideredDaysCount = subscription.skippedDates.filter(h => h.isConsideredForExtension).length;
    
    // FETCH THE PROTECTED VENDOR EXTENSIONS!
    const vendorExtDays = subscription.vendorExtensionDays || 0; 
    
    const baseDuration = getPlanDurationDays(subscription.planType);
    
    // 🚨 THE FIX 1: Capture the old date BEFORE we change it!
    const oldEndDate = subscription.endDate ? new Date(subscription.endDate) : null;
    
    const newEndDate = new Date(subscription.startDate);
    
    // Add base duration + student holidays + vendor emergencies
    newEndDate.setDate(newEndDate.getDate() + (baseDuration - 1) + consideredDaysCount + vendorExtDays);
    
    subscription.endDate = newEndDate;
    const updatedSubscription = await subscription.save();

    // 🚨 THE FIX 2: Shift the upcoming "Sleeping Giants"
    try {
      if (oldEndDate && updatedSubscription.endDate) {
        const deltaMs = updatedSubscription.endDate.getTime() - oldEndDate.getTime();
        
        // If the end date moved forward OR backward, we must shift the future plans!
        if (deltaMs !== 0) {
          // Use Math.round to avoid Daylight Savings Time bugs
          const deltaDays = Math.round(deltaMs / (1000 * 60 * 60 * 24));

    // Find future subscriptions that start after the old plan ended
          // Subtract 1 minute just to be safe with database time precision
          const searchDate = new Date(oldEndDate.getTime() - 60000); 

          const futureSubs = await Subscription.find({
            customer: customerId,
            vendor: subscription.vendor,
            // 🚨 THE FIX: Strictly match the plan type and session!
            planType: subscription.planType,
            preferredSession: subscription.preferredSession,
            startDate: { $gt: searchDate }
          });

          // Shift the start AND end date of every queued matching plan!
          for (const f of futureSubs) {
            f.startDate = new Date(f.startDate.getTime() + deltaDays * 24 * 60 * 60 * 1000);
            if (f.endDate) f.endDate = new Date(f.endDate.getTime() + deltaDays * 24 * 60 * 60 * 1000);
            await f.save();
          }
        }
      }
    } catch (err) {
      console.error('Error shifting future subscriptions after holiday update', err);
    }

    res.status(200).json({
      message: 'Holidays updated successfully.',
      subscription: updatedSubscription,
      ignoredDates
    });
  } catch (error) {
    console.error('Error updating holidays:', error);
    res.status(500).json({ error: 'Server error updating holiday plan' });
  }
};
exports.getSubscriptionById = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const subscriptionId = req.params.id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      customer: customerId
    }).populate('vendor', 'businessName');

    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found for this customer." });
    }

    res.status(200).json(subscription);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({ error: "Server error fetching subscription" });
  }
};

// In controllers/customerController.js
exports.getCustomerDashboard = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;

    // Fetch the active subscription
    const activeSubscription = await Subscription.findOne({ 
        customer: customerId, // ensure this matches your schema (customer vs customerId)
        status: 'active' 
    }).populate('vendor');

    let vendorAnnouncements = [];
    let isUnpaid = false;

    if (activeSubscription) {
      // 1. Fetch announcements
      const latestAnnouncement = await Announcement.findOne({ 
          vendorId: activeSubscription.vendor._id 
      }).sort({ createdAt: -1 });

      if (latestAnnouncement) {
        vendorAnnouncements = [{
          ...latestAnnouncement.toObject(),
          vendorName: activeSubscription.vendor?.businessName || 'Vendor'
        }];
      }
      
      // 2. NEW: Check if the vendor marked them as unpaid!
      // If it's explicitly 'unpaid', or if the field is missing (old data), flag it.
      if (activeSubscription.paymentStatus === 'unpaid' || !activeSubscription.paymentStatus) {
        isUnpaid = true;
      }
    }

    res.status(200).json({
      user: req.user,
      subscription: activeSubscription,
      announcements: vendorAnnouncements,
      hasPendingBill: isUnpaid, // Send the flag to the frontend!
      // ... stats, todaysMenu, etc.
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Dashboard fetch failed" });
  }
};

exports.getDashboardData = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // 1. Fetch ALL subscriptions for this user first
    const allSubscriptions = await Subscription.find({ customer: customerId })
      .populate('vendor', 'businessName weeklyMenu');

   // 🚨 THE UPGRADE: Make sure the plan has actually started!
  // 🚨 THE UPGRADE: Make sure the plan has actually started!
    const activeSubscriptions = allSubscriptions.filter(sub => {
      const statusMatch = String(sub.status || '').trim().toLowerCase() === 'active';
      
      // 1. Has the end date passed yet?
      const endsInFuture = sub.endDate ? new Date(sub.endDate) >= todayMidnight : true;
      
      // 2. HAS THE START DATE ARRIVED YET?
      // 🚨 THE MIDNIGHT MATH FIX: We must check if it starts BEFORE tomorrow midnight, 
      // otherwise plans approved today at 2 PM get hidden!
      const tomorrowMidnight = new Date(todayMidnight);
      tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
      
      const startedAlready = sub.startDate ? new Date(sub.startDate) < tomorrowMidnight : true;
      
      return statusMatch && endsInFuture && startedAlready;
    });

    // 3. Calculate Overdue Bills
    const today = new Date();
    let hasPendingBill = false;

    activeSubscriptions.forEach(sub => {
      if (String(sub.paymentStatus || '').trim().toLowerCase() === 'unpaid' && sub.endDate) {
        const endDate = new Date(sub.endDate);
        if (today > endDate) {
          hasPendingBill = true;
        }
      }
    });

    let todaysMenu = null;
    let announcements = [];
    let weeklyMenus = [];

    // 4. Load Data for the Primary Subscription
    if (activeSubscriptions.length > 0) {
      const primarySub = activeSubscriptions[0];

      if (primarySub.vendor) {
        todaysMenu = await DailyMenu.findOne({
          vendor: primarySub.vendor._id,
          date: { $gte: todayMidnight }
        });

        // Use your fallback logic if DailyMenu isn't set
        const weeklyMenuFromVendor = primarySub.vendor.weeklyMenu || defaultWeeklyMenu();
        if (!todaysMenu) {
          todaysMenu = buildTodaysMenuFromWeekly(weeklyMenuFromVendor);
        }

        const latestAnnouncement = await Announcement.findOne({
          vendorId: primarySub.vendor._id
        }).sort({ createdAt: -1 });

        if (latestAnnouncement) {
          announcements = [{
            ...latestAnnouncement.toObject(),
            vendorName: primarySub.vendor.businessName || 'Vendor'
          }];
        }
      }
    }

    // 5. Build weekly menus array
    weeklyMenus = activeSubscriptions
      .filter((sub) => sub.vendor)
      .map((sub) => ({
        subscriptionId: sub._id,
        vendorId: sub.vendor._id,
        vendorName: sub.vendor.businessName || 'Vendor',
        weeklyMenu: sub.vendor.weeklyMenu || defaultWeeklyMenu()
      }));
// 🚨 THE FIX: Define tomorrow midnight so we don't accidentally fetch today's active plans!
    const tomorrowMidnightForUpcoming = new Date(todayMidnight);
    tomorrowMidnightForUpcoming.setDate(tomorrowMidnightForUpcoming.getDate() + 1);

    // 🚨 ZERO-TOUCH MULTI-PLAN ENGINE: Grab ALL sleeping future active plans
    const upcomingSubscriptions = await Subscription.find({
      customer: customerId,
      status: 'active',
      // 🚨 MUST start strictly tomorrow or later!
      startDate: { $gte: tomorrowMidnightForUpcoming } 
    }).populate('vendor', 'businessName weeklyMenu');

    const hasUpcomingPlan = upcomingSubscriptions.length > 0;

    // 6. Send it to Flutter
    res.status(200).json({
      user: await User.findById(customerId).select('name email location'),
      subscriptions: activeSubscriptions, 
      subscription: activeSubscriptions.length > 0 ? activeSubscriptions[0] : null,
      hasPendingBill: hasPendingBill,
      
      hasUpcomingPlan: hasUpcomingPlan,
      upcomingSubscriptions: upcomingSubscriptions, // <-- Send the clean Array!
      
      todaysMenu: todaysMenu || null,
      weeklyMenus,
      announcements,
      stats: {
        activeSubscriptions: activeSubscriptions.length + upcomingSubscriptions.length,
        totalOrders: 0, 
        monthlySpend: 0
      }
    });
  } catch (error) {
    console.error("Dashboard Data Error:", error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
};
exports.getAllVendors = async (req, res) => {
  try {
    // Find all vendor profiles in the database
    const vendors = await VendorProfile.find();
    
    res.status(200).json(vendors);
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ message: 'Server error fetching vendors' });
  }
};

// Get a single vendor by ID
exports.getVendorById = async (req, res) => {
  try {
    // req.params.id grabs the ID directly from the URL!
    const vendor = await VendorProfile.findById(req.params.id);
    
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }
    
    res.status(200).json(vendor);
  } catch (error) {
    console.error("Error fetching vendor details:", error);
    res.status(500).json({ message: 'Server error fetching vendor details' });
  }
};

exports.createSubscriptionRequest = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
   const { vendorId, planType, mealType, preferredSession, requestedDate } = req.body; // 🚨 ADDED requestedDate HERE!

    // 1. Fetch the Vendor to get their price AND holiday policy
    const vendor = await VendorProfile.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: 'Kitchen not found.' });

    // 2. Determine Duration and price based on Plan Type
    let durationDays = 30; // Default monthly duration
    let totalBill = vendor.monthlyFullPrice || 0;

    if (planType === 'monthly_half') {
      durationDays = 30;
      totalBill = vendor.monthlyHalfPrice || 0;
    } else if (planType === 'weekly') {
      durationDays = 7;
      totalBill = vendor.weeklyPrice || 0;
    } else if (planType === 'single') {
      durationDays = 1;
      totalBill = vendor.singleMealPrice || 0;
    } else if (planType === '15_days') {
      durationDays = 15;
      totalBill = vendor.weeklyPrice ? Math.round((vendor.weeklyPrice / 7) * 15) : 0;
    }

 // Update the destructured body at the top of the function to include requestedDate:
    // const { vendorId, planType, mealType, preferredSession, requestedDate } = req.body;

    // 3. Set Start and Baseline End Dates
    let startDate = new Date();
    
    // 🚨 THE FIX: If it's a trial, use the date the student selected!
    if (planType === 'single' && requestedDate) {
      startDate = new Date(requestedDate);
    }
    
    startDate.setHours(0, 0, 0, 0); // Normalize to midnight
    
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (durationDays - 1)); // For 'single', duration is 1, so endDate = startDate

    // 4. Create the Smart Calendar Subscription
    const newSubscription = await Subscription.create({
      customer: customerId,
      vendor: vendorId,
      planType: planType || 'monthly_full',
      mealType: mealType,
      preferredSession: preferredSession || 'both',
      startDate: startDate,
      endDate: endDate,
      vendorConsidersHolidays: vendor.considersHolidays || false,
      totalBill: totalBill,
      paymentStatus: 'unpaid',
      status: 'pending' // Vendor still needs to approve it
    });

    res.status(201).json({ message: 'Request sent to the kitchen!', subscription: newSubscription });
  } catch (error) {
    console.error("Subscription Error:", error);
    res.status(500).json({ message: 'Server error creating request.' });
  }
};
// Get all subscriptions for the logged-in customer
exports.getMySubscriptions = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;

    // Find all subscriptions for this user and populate the vendor's business name
    const subscriptions = await Subscription.find({ customer: customerId })
      .populate('vendor', 'businessName')
      .sort({ createdAt: -1 }); // Shows the newest requests at the top!

    const vendorIds = subscriptions
      .map((sub) => sub.vendor?._id)
      .filter((id) => id);

    const vendorHolidays = await VendorHoliday.find({ vendor: { $in: vendorIds } });

    const vendorHolidayMap = vendorHolidays.reduce((acc, holiday) => {
      const vendorId = holiday.vendor.toString();
      acc[vendorId] = acc[vendorId] || [];
      acc[vendorId].push({
        dateKey: holiday.dateKey,
        time: holiday.time || 'full_day',
        reason: holiday.reason
      });
      return acc;
    }, {});

    const enriched = subscriptions.map((sub) => {
      const vendorId = sub.vendor?._id?.toString();
      const subObj = sub.toObject();
      return {
        ...subObj,
        vendorHolidays: vendorId ? vendorHolidayMap[vendorId] || [] : []
      };
    });

    res.status(200).json(enriched);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ message: 'Server error fetching subscriptions' });
  }
};

exports.getSubscribedWeeklyMenus = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const activeSubscriptions = await Subscription.find({
      customer: customerId,
      status: 'active'
    }).populate('vendor', 'businessName weeklyMenu');

    const menus = activeSubscriptions
      .filter((sub) => sub.vendor)
      .map((sub) => ({
        subscriptionId: sub._id,
        vendorId: sub.vendor._id,
        vendorName: sub.vendor.businessName || 'Vendor',
        weeklyMenu: sub.vendor.weeklyMenu || defaultWeeklyMenu()
      }));

    res.status(200).json({ menus });
  } catch (error) {
    console.error('Error fetching subscribed weekly menus:', error);
    res.status(500).json({ message: 'Server error fetching weekly menus' });
  }
};

// --- Get My Orders (derived from customer subscriptions) ---
exports.getMyOrders = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subscriptions = await Subscription.find({ customer: customerId })
      .populate('vendor', 'businessName deliveryType')
      .sort({ createdAt: -1 });

    const normalizePlanType = (planType) => {
      if (!planType) return 'Plan';
      return String(planType)
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    const normalizeMealType = (mealType) => {
      if (!mealType) return '';
      const normalized = String(mealType).toLowerCase();
      if (normalized === 'nonveg') return 'Non-Veg';
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const formatStatus = (status, isExpiredByDate) => {
      if (isExpiredByDate) return 'Expired';
      const normalized = String(status || '').toLowerCase();
      if (!normalized) return 'Pending';
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const formattedOrders = subscriptions.map((sub) => {
      const statusValue = String(sub.status || '').toLowerCase();
      const endDate = sub.endDate ? new Date(sub.endDate) : null;
      const isExpiredByDate = Boolean(endDate && endDate < today);
      const isPast =
        isExpiredByDate ||
        ['cancelled', 'expired'].includes(statusValue);

      return {
        _id: sub._id,
        vendorName: sub.vendor?.businessName || 'Unknown Vendor',
        orderNumber: String(sub._id).slice(-6).toUpperCase(),
        status: formatStatus(sub.status, isExpiredByDate),
        planType: normalizePlanType(sub.planType),
        mealType: normalizeMealType(sub.mealType),
        orderDate: sub.createdAt,
        startDate: sub.startDate,
        endDate: sub.endDate,
        deliveryType: sub.vendor?.deliveryType || 'Delivery',
        totalAmount: sub.price || 0,
        isPast
      };
    });

    const activeOrders = formattedOrders.filter((order) => !order.isPast);
    const pastOrders = formattedOrders.filter((order) => order.isPast);

    res.status(200).json({
      activeOrders,
      pastOrders
    });
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    res.status(500).json({ message: 'Server error fetching orders' });
  }
};

// --- Homemade products marketplace for customers ---
exports.getHomemadeProducts = async (req, res) => {
  try {
    const items = await HomemadeItem.find({
      isActive: true,
      inStock: true,
      stockQuantity: { $gt: 0 }
    })
      .populate('vendor', 'businessName serviceArea')
      .sort({ createdAt: -1 });

    const formattedItems = items
      .filter((item) => item.vendor)
      .map((item) => ({
        _id: item._id,
        name: item.name,
        category: item.category,
        description: item.description,
        imageUrl: item.imageUrl,
        unit: item.unit,
        price: item.price,
        stockQuantity: item.stockQuantity,
        vendorId: item.vendor._id,
        vendorName: item.vendor.businessName,
        serviceArea: item.vendor.serviceArea
      }));

    res.status(200).json(formattedItems);
  } catch (error) {
    console.error("Error fetching homemade products:", error);
    res.status(500).json({ message: 'Server error fetching homemade products' });
  }
};

exports.placeHomemadeOrder = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const { itemId, quantity } = req.body;

    if (!itemId) {
      return res.status(400).json({ message: 'itemId is required.' });
    }

    const parsedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
    const item = await HomemadeItem.findById(itemId);
    if (!item || !item.isActive || !item.inStock) {
      return res.status(404).json({ message: 'Item is not available for ordering.' });
    }

    const previousStock = item.stockQuantity;
    const updatedItem = await HomemadeItem.findOneAndUpdate(
      {
        _id: itemId,
        isActive: true,
        inStock: true,
        stockQuantity: { $gte: parsedQuantity }
      },
      { $inc: { stockQuantity: -parsedQuantity } },
      { new: true }
    );

    if (!updatedItem) {
      return res.status(400).json({ message: `Only ${previousStock} item(s) left in stock.` });
    }

    if (updatedItem.stockQuantity <= 0 || !updatedItem.isActive) {
      updatedItem.stockQuantity = Math.max(0, updatedItem.stockQuantity);
      updatedItem.inStock = false;
      await updatedItem.save();
    }

    const totalAmount = parsedQuantity * item.price;

    const order = await HomemadeOrder.create({
      customer: customerId,
      vendor: item.vendor,
      item: item._id,
      itemName: item.name,
      itemUnit: item.unit,
      pricePerUnit: item.price,
      quantity: parsedQuantity,
      totalAmount
    });

    await HomemadeStockLog.create({
      vendor: item.vendor,
      item: item._id,
      order: order._id,
      action: 'order_placed',
      quantityChange: -parsedQuantity,
      previousStock,
      newStock: updatedItem.stockQuantity,
      note: `Order placed by customer ${customerId}`
    });

    res.status(201).json({
      message: 'Order placed successfully.',
      order
    });
  } catch (error) {
    console.error("Error placing homemade order:", error);
    res.status(500).json({ message: 'Server error placing homemade order' });
  }
};

exports.getMyHomemadeOrders = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const orders = await HomemadeOrder.find({ customer: customerId })
      .populate('vendor', 'businessName')
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map((order) => ({
      _id: order._id,
      itemName: order.itemName,
      itemUnit: order.itemUnit,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      status: order.status,
      vendorName: order.vendor?.businessName || 'Unknown Vendor',
      createdAt: order.createdAt
    }));

    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Error fetching homemade orders:", error);
    res.status(500).json({ message: 'Server error fetching homemade orders' });
  }
};

// --- Customer Reviews (DB-backed) ---
exports.getCustomerReviews = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;

    const [allReviews, myReviews] = await Promise.all([
      Review.find({})
        .populate('vendor', 'businessName')
        .populate('customer', 'name')
        .sort({ createdAt: -1 }),
      Review.find({ customer: customerId })
        .populate('vendor', 'businessName')
        .sort({ createdAt: -1 })
    ]);

    const formattedAllReviews = allReviews
      .filter((review) => review.vendor && review.customer)
      .map((review) => ({
        _id: review._id,
        vendorId: review.vendor._id,
        vendorName: review.vendor.businessName,
        customerName: review.customer.name,
        rating: review.rating,
        text: review.text,
        createdAt: review.createdAt,
        isMine: String(review.customer._id) === String(customerId)
      }));

    const formattedMyReviews = myReviews
      .filter((review) => review.vendor)
      .map((review) => ({
        _id: review._id,
        vendorId: review.vendor._id,
        vendorName: review.vendor.businessName,
        rating: review.rating,
        text: review.text,
        createdAt: review.createdAt
      }));

    res.status(200).json({
      allReviews: formattedAllReviews,
      myReviews: formattedMyReviews
    });
  } catch (error) {
    console.error("Error fetching customer reviews:", error);
    res.status(500).json({ message: 'Server error fetching reviews' });
  }
};

exports.createOrUpdateReview = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const { vendorId, rating, text } = req.body;

    if (!vendorId || !rating || !text) {
      return res.status(400).json({ message: 'vendorId, rating and text are required.' });
    }

    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ message: 'rating must be an integer between 1 and 5.' });
    }

    const cleanedText = String(text).trim();
    if (!cleanedText) {
      return res.status(400).json({ message: 'Review text is required.' });
    }

    const vendor = await VendorProfile.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    const review = await Review.findOneAndUpdate(
      { vendor: vendorId, customer: customerId },
      {
        vendor: vendorId,
        customer: customerId,
        rating: parsedRating,
        text: cleanedText
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).populate('vendor', 'businessName');

    await recomputeVendorRating(vendor._id);

    res.status(200).json({
      message: 'Review saved successfully.',
      review: {
        _id: review._id,
        vendorId: review.vendor._id,
        vendorName: review.vendor.businessName,
        rating: review.rating,
        text: review.text,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt
      }
    });
  } catch (error) {
    console.error("Error saving review:", error);
    res.status(500).json({ message: 'Server error saving review' });
  }
};

exports.deleteMyReview = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const { reviewId } = req.params;

    const review = await Review.findOneAndDelete({ _id: reviewId, customer: customerId });
    if (!review) {
      return res.status(404).json({ message: 'Review not found.' });
    }

    await recomputeVendorRating(review.vendor);
    res.status(200).json({ message: 'Review deleted successfully.' });
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).json({ message: 'Server error deleting review' });
  }
};

// --- Get Customer Payment Details ---
exports.getCustomerPayments = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;

    // Fetch the active subscription for this customer
    const activeSub = await Subscription.findOne({
      customer: customerId,
      status: 'active' 
    }).populate('vendor', 'businessName');

    if (!activeSub) {
        return res.status(200).json({
            pendingAmount: 0,
            totalPaid: 0,
            thisMonth: 0,
            transactions: []
        });
    }

    const today = new Date();
    let baseDuration = 30;
    if (activeSub.planType.includes('weekly') || activeSub.planType.includes('7_days')) baseDuration = 7;
    if (activeSub.planType.includes('15_days')) baseDuration = 15;

    const skippedDaysCount = activeSub.skippedDates ? activeSub.skippedDates.length : 0;
    const totalSpan = baseDuration + skippedDaysCount;

    const startDate = new Date(activeSub.startDate || activeSub.createdAt);
    const fallbackEndDate = new Date(startDate);
    fallbackEndDate.setDate(fallbackEndDate.getDate() + totalSpan);
    const endDate = activeSub.endDate ? new Date(activeSub.endDate) : fallbackEndDate;

    const diffTime = endDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let pendingAmount = 0;
    let transactions = [];

    // Determine Pending Amount
    if (activeSub.paymentStatus === 'unpaid' || daysLeft <= 5) {
        pendingAmount = activeSub.price;
        // Add a "Pending" transaction record
        transactions.push({
            id: `pending-${activeSub._id}`,
            vendorName: activeSub.vendor.businessName,
            type: 'Subscription',
            status: 'pending',
            date: 'Due Now',
            method: 'Pending',
            amount: activeSub.price
        });
    }

    // Determine Total Paid & This Month (Simplification: Assuming if paid, they paid the price)
    // In a real app, you'd have a separate 'Transactions' table. Here we infer from the subscription state.
    let totalPaid = 0;
    let thisMonthPaid = 0;

    if (activeSub.paymentStatus === 'paid') {
        totalPaid += activeSub.price;
        
        // Check if paid this month
        const paymentDate = activeSub.lastPaymentDate ? new Date(activeSub.lastPaymentDate) : startDate;
        if (paymentDate.getMonth() === today.getMonth() && paymentDate.getFullYear() === today.getFullYear()) {
            thisMonthPaid += activeSub.price;
        }

        // Add a "Paid" transaction record
        const formattedDate = paymentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        transactions.push({
            id: `paid-${activeSub._id}`,
            vendorName: activeSub.vendor.businessName,
            type: 'Subscription',
            status: 'paid',
            date: formattedDate,
            method: 'UPI / Cash', // Mock method
            amount: activeSub.price
        });
    }

    res.status(200).json({
      pendingAmount,
      totalPaid,
      thisMonth: thisMonthPaid,
      transactions
    });

  } catch (error) {
    console.error("Error fetching customer payments:", error);
    res.status(500).json({ message: 'Server error fetching payments' });
  }
};

exports.getCustomerTransactions = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;

    const transactions = await Transaction.find({ customerId }).sort({ createdAt: -1 });
    const vendorIds = [...new Set(transactions.map((txn) => txn.vendorId.toString()))];
    const vendorProfiles = await VendorProfile.find({ vendorId: { $in: vendorIds } }).select('vendorId businessName');
    const vendorNameById = vendorProfiles.reduce((acc, profile) => {
      acc[profile.vendorId.toString()] = profile.businessName;
      return acc;
    }, {});

    const formattedTransactions = transactions.map((txn) => ({
      _id: txn._id,
      vendorName: vendorNameById[txn.vendorId.toString()] || 'Kitchen',
      amount: txn.amount,
      paymentMethod: txn.paymentMethod || 'cash',
      planType: txn.planType || '',
      note: txn.note || '',
      date: txn.date || txn.createdAt
    }));

    res.status(200).json(formattedTransactions);
  } catch (error) {
    console.error('Error fetching customer transactions:', error);
    res.status(500).json({ message: 'Server error fetching transactions.' });
  }
};

// POST /api/customer/register
exports.registerCustomer = async (req, res) => {
  try {
    const { name, phone, location, roomNumber } = req.body;
    const { uid, email } = req.firebaseUser; // Comes from our special registration middleware

    console.log('📝 Registration Attempt:', { uid, email, name, phone, location, roomNumber });

    // 1. Check if user already exists
    const existingUser = await User.findOne({ firebaseUid: uid });
    if (existingUser) {
      console.log('⚠️ User already registered:', uid);
      return res.status(400).json({ message: 'User already registered.' });
    }

    // 2. Create the Customer User document
    const newUser = await User.create({
      firebaseUid: uid,
      name: name,
      email: email,
      phone: phone,
      location: location, // e.g., "SCSMCOE Boys Hostel"
      roomNumber: roomNumber,
      role: 'customer' // Crucial: This marks them as a student!
    });

    console.log('✅ User created successfully:', newUser._id);

    res.status(201).json({ 
      message: 'Student successfully registered!', 
      user: newUser 
    });

  } catch (error) {
    console.error("❌ Student Registration Error:", error.message);
    console.error("Full Error:", error);
    res.status(500).json({ message: 'Server error during registration', error: error.message });
  }
};
// GET /api/customer/announcements
exports.getKitchenAnnouncements = async (req, res) => {
  try {
    // 1. Find the student's active subscription to know WHICH kitchen to pull from
    const activeSub = await Subscription.findOne({ 
      customer: req.user.userId || req.user.id, 
      status: 'active' 
    });

    if (!activeSub) {
      return res.status(200).json([]); // If they don't have a kitchen, return empty
    }

    // 2. Fetch the announcements! 
    // (We don't even have to check the time, because MongoDB's TTL already deleted the old ones!)
    const announcements = await Announcement.find({ vendorId: activeSub.vendor })
      .sort({ createdAt: -1 });

    res.status(200).json(announcements);

  } catch (error) {
    console.error("Error fetching kitchen announcements:", error);
    res.status(500).json({ message: 'Server error fetching announcements' });
  }
};

// POST /api/customer/reviews/:vendorId
exports.submitReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const vendorIdParam = req.params.vendorId;
    const customerId = req.user.userId || req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Please provide a valid rating between 1 and 5.' });
    }

    // 🚨 FIND THE VENDOR PROFILE (could be indexed by User ID or Profile ID)
    let vendorProfile = await VendorProfile.findOne({
      $or: [{ vendorId: vendorIdParam }, { _id: vendorIdParam }]
    });

    if (!vendorProfile) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    // Use the Profile's ID as the canonical vendorId for the review
    const canonicalVendorId = vendorProfile._id;

    // 1. Update or Create the Review (Upsert)
    await Review.findOneAndUpdate(
      { vendorId: canonicalVendorId, customerId },
      { rating, comment },
      { new: true, upsert: true }
    );

    // 2. Recalculate the Kitchen's Total Average
    const allReviews = await Review.find({ vendorId: canonicalVendorId });
    const totalReviews = allReviews.length;
    
    const sumRatings = allReviews.reduce((sum, rev) => sum + rev.rating, 0);
    const averageRating = totalReviews > 0 ? (sumRatings / totalReviews).toFixed(1) : 0;

    // 3. Update the Vendor Profile
    vendorProfile.rating = parseFloat(averageRating);
    vendorProfile.totalReviews = totalReviews;
    await vendorProfile.save();

    res.status(200).json({ 
      message: 'Review submitted successfully!', 
      newAverage: averageRating,
      totalReviews: totalReviews
    });

  } catch (error) {
    console.error("Error submitting review:", error);
    res.status(500).json({ message: 'Server error submitting review' });
  }
};

// POST /api/customer/subscriptions/:id/renew
exports.renewSubscription = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const oldSubId = req.params.id;

    // 1. Find the expiring subscription
    const oldSub = await Subscription.findOne({ _id: oldSubId, customer: customerId });
    if (!oldSub) return res.status(404).json({ message: 'Subscription not found.' });

 // 2. SAFETY CHECK: Ensure they haven't already renewed THIS SPECIFIC plan!
    const existingFuturePlan = await Subscription.findOne({
      customer: customerId,
      vendor: oldSub.vendor,
      // 🚨 THE FIX: Make sure we check the specific plan and session!
      planType: oldSub.planType,
      preferredSession: oldSub.preferredSession, 
      startDate: { $gt: oldSub.endDate } // Starts after the current one ends
    });
    
    if (existingFuturePlan) {
      // If the user already has a future plan queued, return it as a successful outcome
      const populated = await Subscription.findById(existingFuturePlan._id).populate('vendor', 'businessName weeklyMenu');
      return res.status(200).json({ message: 'You have already renewed this plan.', subscription: populated });
    }

    // 3. Fetch the Vendor Profile (We do this to get the LATEST prices, in case the vendor raised them)
    const vendor = await VendorProfile.findById(oldSub.vendor);
    if (!vendor) return res.status(404).json({ message: 'Kitchen no longer active.' });

    // 4. Calculate New Dates (Starts the day AFTER the old one ends)
    const newStartDate = new Date(oldSub.endDate);
    newStartDate.setDate(newStartDate.getDate() + 1);
    newStartDate.setHours(0, 0, 0, 0);

    // Determine Duration and Latest Price
    let durationDays = 30;
    let newTotalBill = vendor.monthlyFullPrice || oldSub.totalBill;
    const plan = oldSub.planType.toLowerCase();

    if (plan === 'monthly_half') {
      durationDays = 30;
      newTotalBill = vendor.monthlyHalfPrice || oldSub.totalBill;
    } else if (plan === 'weekly') {
      durationDays = 7;
      newTotalBill = vendor.weeklyPrice || oldSub.totalBill;
    } else if (plan === '15_days') {
      durationDays = 15;
      newTotalBill = vendor.weeklyPrice ? Math.round((vendor.weeklyPrice / 7) * 15) : oldSub.totalBill;
    } else if (plan === 'single') {
      return res.status(400).json({ message: 'Single meals cannot be auto-renewed.' });
    }

    const newEndDate = new Date(newStartDate);
    newEndDate.setDate(newEndDate.getDate() + (durationDays - 1));

    // 5. Create the Renewed Plan (Queued as upcoming)
    // NOTE: mark as 'pending' so it doesn't appear as currently active immediately
    // The UI will still surface it as an upcoming plan for this customer only.
// Inside renewSubscription -> Subscription.create
    const renewedSub = await Subscription.create({
      customer: customerId,
      vendor: oldSub.vendor,
      planType: oldSub.planType,
      mealType: oldSub.mealType,
      preferredSession: oldSub.preferredSession,
      startDate: newStartDate,
      endDate: newEndDate,
      vendorConsidersHolidays: oldSub.vendorConsidersHolidays,
      totalBill: newTotalBill,
      paymentStatus: 'unpaid',
      status: 'active' // 🚨 ZERO-TOUCH: Born active, sleeps until startDate!
    });

    res.status(201).json({ 
      message: 'Plan successfully renewed!', 
      subscription: renewedSub 
    });

  } catch (error) {
    console.error("Renewal Error:", error);
    res.status(500).json({ message: 'Server error processing renewal.' });
  }
};
// GET /api/customer/profile
exports.getStudentProfile = async (req, res) => {
  try {
    const customerId = req.user.userId || req.user.id;
    const user = await User.findById(customerId).select('-password'); 
    
    if (!user) return res.status(404).json({ message: 'Student profile not found.' });
    
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching profile.' });
  }
};