const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware'); // Your login protection middleware

// The endpoint your Flutter app will target
router.post('/update-token', protect, notificationController.updateFcmToken);

module.exports = router;