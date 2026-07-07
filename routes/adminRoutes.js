const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const adminController = require('../controllers/adminController');

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only admins can access this route.' });
  }
  next();
};

router.get('/dashboard', verifyToken, requireAdmin, adminController.getAdminDashboard);
router.post('/vendor/status', verifyToken, requireAdmin, adminController.updateVendorStatus);
// Add these below your existing dashboard route
router.get('/vendors', verifyToken , requireAdmin, adminController.getAllVendors);
router.get('/students', verifyToken, requireAdmin,adminController.getAllStudents);

module.exports = router;
