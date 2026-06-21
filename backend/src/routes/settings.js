const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

/**
 * POST /api/settings/angel-one
 * Save Angel One credentials to .env file and update process.env
 */
router.post('/angel-one', (req, res) => {
  try {
    const { apiKey, clientCode, password, totpKey } = req.body;
    
    // Update memory
    if (apiKey) process.env.ANGEL_ONE_API_KEY = apiKey;
    if (clientCode) process.env.ANGEL_ONE_CLIENT_CODE = clientCode;
    if (password) process.env.ANGEL_ONE_PASSWORD = password;
    if (totpKey) process.env.ANGEL_ONE_TOTP_KEY = totpKey;

    // Read existing .env
    const envPath = path.join(__dirname, '../../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or append
    const updateEnv = (key, value) => {
      if (!value) return;
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    updateEnv('ANGEL_ONE_API_KEY', apiKey);
    updateEnv('ANGEL_ONE_CLIENT_CODE', clientCode);
    updateEnv('ANGEL_ONE_PASSWORD', password);
    updateEnv('ANGEL_ONE_TOTP_KEY', totpKey);

    // Write back
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');

    // Re-initialize AngelOneProvider if possible
    const { angelOneProvider } = require('../services/angelOneProvider');
    angelOneProvider.apiKey = process.env.ANGEL_ONE_API_KEY;
    angelOneProvider.clientCode = process.env.ANGEL_ONE_CLIENT_CODE;
    angelOneProvider.password = process.env.ANGEL_ONE_PASSWORD;
    angelOneProvider.totpKey = process.env.ANGEL_ONE_TOTP_KEY;
    angelOneProvider.accessToken = null; // Force new login

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Settings save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
