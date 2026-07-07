const User = require('../models/User');
const VendorProfile = require('../models/VendorProfile');
const Subscription = require('../models/Subscription');

// GET /api/admin/dashboard
exports.getAdminDashboard = async (req, res) => {
  try {
    const lockedVendorFilter = {
      $or: [
        { status: { $exists: false } },
        { status: null },
        { status: '' },
        { status: { $ne: 'approved' } }
      ]
    };

    // 1. Get Platform Stats
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalVendors = await VendorProfile.countDocuments({ status: 'approved' });
    const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });

    // 2. Count every kitchen that cannot log in yet.
    const pendingVendorsCount = await VendorProfile.countDocuments(lockedVendorFilter);

    // 3. Fetch the actual list of locked vendors for the approval cards
    const pendingVendors = await VendorProfile.find(lockedVendorFilter)
      .select('businessName ownerName phone serviceArea status createdAt')
      .sort({ createdAt: -1 });

    res.status(200).json({
      stats: {
        totalStudents,
        totalVendors,
        pendingVendors: pendingVendorsCount,
        activeSubscriptions
      },
      pendingApprovals: pendingVendors
    });
  } catch (error) {
    console.error("Admin Dashboard Error:", error);
    res.status(500).json({ message: 'Server error fetching admin data.' });
  }
};
exports.getAllVendors = async (req, res) => {
  try {
    // Ensure you are NOT selecting just a few fields. 
    // Fetch the full document to include ownerName, serviceArea, etc.
    const vendors = await VendorProfile.find({ status: 'approved' }); 
    res.status(200).json(vendors);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching vendors' });
  }
};
// Get all Students
exports.getAllStudents = async (req, res) => {
  try {
    const students = await User.find({ role: 'customer' }).select('-password -__v');
    res.status(200).json(students);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students' });
  }
};
// POST /api/admin/vendor/status
exports.updateVendorStatus = async (req, res) => {
  try {
    const { vendorId, status } = req.body; // status should be 'approved' or 'rejected'

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid vendor status.' });
    }

    const update = {
      status,
      approvalDate: status === 'approved' ? new Date() : null
    };

    // Update the vendor's status in the database
    const updatedVendor = await VendorProfile.findByIdAndUpdate(
      vendorId,
      update,
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({ message: 'Vendor not found.' });
    }

    res.status(200).json({ 
      message: `Kitchen successfully ${status}!`, 
      vendor: updatedVendor 
    });
  } catch (error) {
    console.error("Error updating vendor status:", error);
    res.status(500).json({ message: 'Server error updating status.' });
  }
};
