/**
 * Historical Data Routes
 * Provides OHLCV data, on-demand download, and calculated stats.
 */

const express = require('express');
const router = express.Router();
const HistoricalDataService = require('../services/historicalDataService');
const { getDatabase } = require('../services/database');

// Lazy singleton
let _service = null;
function getService() {
  if (!_service) _service = new HistoricalDataService();
  return _service;
}

/**
 * GET /api/historical/:symbol
 * Return stored historical OHLCV data from the database.
 * Query params:
 *   years     – number of years of data (default 15)
 *   timeframe – candle size, e.g. '1d' (default '1d')
 */
router.get('/:symbol', (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const years = parseInt(req.query.years) || 15;
    const timeframe = req.query.timeframe || '1d';

    const db = getDatabase();
    const data = db.getPriceHistory(symbol, { days: years * 365, timeframe });

    res.json({
      success: true,
      symbol,
      count: data.length,
      years,
      timeframe,
      data
    });
  } catch (error) {
    console.error('Historical GET error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/historical/:symbol/fetch
 * Trigger download of historical data from Yahoo Finance and store in DB.
 * Body: { years: 15 }
 */
router.post('/:symbol/fetch', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const years = (req.body && req.body.years) ? parseInt(req.body.years) : 15;

    const result = await getService().fetchAndStoreHistoricalData(symbol, years);

    res.json({
      success: result.success,
      symbol,
      ...result
    });
  } catch (error) {
    console.error('Historical FETCH error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/historical/:symbol/stats
 * Return calculated stats: CAGR, volatility, max drawdown, all-time high/low.
 */
router.get('/:symbol/stats', (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const stats = getService().calculateHistoricalStats(symbol);

    if (!stats) {
      return res.status(404).json({
        success: false,
        error: `No historical data found for ${symbol}. POST /api/historical/${symbol}/fetch first.`
      });
    }

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Historical STATS error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
