/**
 * Company Details Routes
 * Uses CompanyDetailsService (Yahoo Finance + SQLite cache)
 */

const express = require('express');
const router = express.Router();
const CompanyDetailsService = require('../services/companyDetailsService');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Lazy singleton
let _service = null;
function getService() {
  if (!_service) _service = new CompanyDetailsService();
  return _service;
}

/** Map NSE symbol → Yahoo Finance ticker */
function yahooTicker(symbol) {
  return getService().getYahooSymbol(symbol);
}

/**
 * GET /api/company/:symbol
 * Comprehensive company details (Yahoo Finance + local cache)
 */
router.get('/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const details = await getService().getCompanyDetails(symbol);

    res.json({
      success: true,
      company: {
        ...details,
        exchange: details.exchange || 'NSE',
        series: 'EQ'
      }
    });
  } catch (error) {
    console.error('Company details route error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/company/:symbol/quote
 * Live quote from Yahoo Finance
 */
router.get('/:symbol/quote', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const ticker = yahooTicker(symbol);

    const quote = await yahooFinance.quote(ticker);

    res.json({
      success: true,
      quote: {
        symbol,
        lastPrice: quote.regularMarketPrice || 0,
        change: quote.regularMarketChange || 0,
        changePercent: quote.regularMarketChangePercent || 0,
        volume: quote.regularMarketVolume || 0,
        high: quote.regularMarketDayHigh || 0,
        low: quote.regularMarketDayLow || 0,
        open: quote.regularMarketOpen || 0,
        previousClose: quote.regularMarketPreviousClose || 0,
        marketCap: quote.marketCap || 0,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
        source: 'Yahoo Finance'
      }
    });
  } catch (error) {
    console.error('Quote route error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/company/:symbol/news
 * Placeholder – news integration TODO
 */
router.get('/:symbol/news', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    res.json({ success: true, symbol, news: [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
