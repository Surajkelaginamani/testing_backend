require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');

// --- FIREBASE ADMIN SETUP ---
// Point this to the JSON file you downloaded from Firebase Console


const serviceAccount = require('./firebase-key.json'); // Loads your file!

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
console.log("Firebase Admin SDK initialized successfully!");

// --- EXPRESS APP SETUP ---
const app = express();
app.use(cors());
app.use(express.json()); // Allows us to read JSON data from the Flutter app

// --- DATABASE CONNECTION ---
// Make sure to create a .env file with your MONGO_URI string!
console.log('🔧 Connecting to MongoDB URI:', process.env.MONGO_URI?.substring(0, 80) + '...');

mongoose.connect(process.env.MONGO_URI, {
  // Removed the deprecated useNewUrlParser and useUnifiedTopology!
  tls: true,                            
  tlsAllowInvalidCertificates: false,   
  serverSelectionTimeoutMS: 10000        
})   
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    console.error('🔎 Verify your Atlas connection string, IP whitelist, and TLS settings.');
  });

// --- API ROUTES GO HERE ---
const vendorRoutes = require('./routes/vendorRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');

app.use('/api/vendor', vendorRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);
// This tells Express: "If a request starts with /api/vendor, send it to vendorRoutes!"


app.get('/', (req, res) => {
  res.send('MealMitra API is running strong!');
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});

