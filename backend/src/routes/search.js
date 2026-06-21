/**
 * Search Routes - Search NSE/BSE stocks
 */

const express = require('express')
const router = express.Router()
const scripMaster = require('../services/scripMaster')

/**
 * GET /api/search
 * Search for stocks by symbol or name
 */
router.get('/', async (req, res) => {
  try {
    const { q: query, limit } = req.query
    const resultsLimit = parseInt(limit) || 20

    const results = scripMaster.search(query || '', resultsLimit)

    res.json({
      success: true,
      count: results.length,
      query: query || '',
      results: results.map(s => ({
        symbol: s.symbol,
        name: s.name,
        token: s.token,
        exchange: s.exchange,
        sector: s.sector || 'Unknown'
      }))
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/search/suggestions
 * Quick suggestions for autocomplete (max 10)
 */
router.get('/suggestions', async (req, res) => {
  try {
    const { q: query } = req.query
    
    if (!query || query.length < 1) {
      return res.json({ suggestions: [] })
    }

    const results = scripMaster.search(query, 10)
    
    res.json({
      suggestions: results.map(s => ({
        symbol: s.symbol,
        name: s.name,
        label: `${s.symbol} - ${s.name}`
      }))
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/search/:symbol
 * Get details for a specific symbol
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params
    const scrip = scripMaster.getBySymbol(symbol)

    if (!scrip) {
      return res.status(404).json({
        success: false,
        error: 'Stock not found'
      })
    }

    res.json({
      success: true,
      result: scrip
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/search/popular/list
 * Get popularly traded stocks
 */
router.get('/popular/list', async (req, res) => {
  try {
    // Return top 50 most traded stocks
    const popularSymbols = [
      'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'SBIN',
      'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT', 'AXISBANK', 'BAJFINANCE', 'MARUTI',
      'ASIANPAINT', 'TATAMOTORS', 'TATASTEEL', 'WIPRO', 'HCLTECH', 'SUNPHARMA',
      'NTPC', 'POWERGRID', 'TITAN', 'ADANIENT', 'ADANIPORTS', 'DABUR', 'ULTRACEMCO',
      'GRASIM', 'DRREDDY', 'ONGC', 'BPCL', 'SHREECEM', 'JSWSTEEL', 'HINDALCO',
      'COALINDIA', 'BAJAJFINSV', 'M&M', 'HEROMOTOCO', 'BAJAJ-AUTO', 'EICHERMOT',
      'TATACONSUM', 'NESTLEIND', 'BRITANNIA', 'CIPLA', 'APOLLOHOSP', 'DIVISLAB',
      'INDIGO', 'ZOMATO', 'JIOFIN'
    ]

    const results = popularSymbols.map(s => scripMaster.getBySymbol(s)).filter(Boolean)

    res.json({
      success: true,
      count: results.length,
      results
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

module.exports = router
