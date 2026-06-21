const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

/**
 * POST /api/settings/angel-one
 * Save Angel One credentials to .env file and update process.env
 */
// POST /api/settings/angel-one endpoint has been removed for security.
// Credentials must now be manually securely configured in the .env file.
router.post('/angel-one', (req, res) => {
  res.status(403).json({ 
    success: false, 
    error: 'SECURITY LOCKDOWN: API updating of broker credentials has been permanently disabled. Please configure your broker credentials manually in the backend/.env file.' 
  });
});

// API key validation route can remain
router.get('/validate', (req, res) => {
  res.json({ success: true, message: 'Configuration valid' });
});

module.exports = router;
