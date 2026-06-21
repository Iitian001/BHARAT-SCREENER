/**
 * ML Prediction Routes
 */

const express = require('express')
const router = express.Router()
const mlModel = require('../ml/mlModel')
const historicalStore = require('../services/historicalStore')
const scripMaster = require('../services/scripMaster')

/**
 * POST /api/prediction/analyze
 * Generate ML prediction for a stock
 */
router.post('/analyze', async (req, res) => {
  try {
    const { symbol, period = '1d' } = req.body
    
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required'
      })
    }

    // Check if we have historical data
    let historicalData = historicalStore.getData(symbol)
    
    if (!historicalData || historicalData.length < 50) {
      // Try to fetch historical data (this would call Angel One API)
      historicalData = await historicalStore.fetchAndStore(symbol)
    }

    if (!historicalData || historicalData.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient historical data for prediction. Need at least 50 data points.'
      })
    }

    // Get current tick data if available
    const currentData = {
      price: historicalData[historicalData.length - 1]?.close || 0,
      volume: historicalData[historicalData.length - 1]?.volume || 0,
      timestamp: new Date().toISOString()
    }

    // Generate deep learning prediction
    const prediction = await mlModel.predictAsync({
      historicalData,
      currentData,
      symbol
    })

    res.json(prediction)
  } catch (error) {
    console.error('Prediction error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/prediction/history
 * Get prediction history
 */
router.get('/history', async (req, res) => {
  try {
    const { symbol, status, limit = 100 } = req.query
    
    let history = mlModel.predictionHistory
    
    // Filter by symbol
    if (symbol) {
      history = history.filter(p => p.symbol === symbol.toUpperCase())
    }
    
    // Filter by status
    if (status && ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'].includes(status)) {
      history = history.filter(p => p.status === status)
    }
    
    // Apply limit
    history = history.slice(-parseInt(limit))

    res.json({
      success: true,
      count: history.length,
      history
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/prediction/accuracy
 * Get prediction accuracy statistics
 */
router.get('/accuracy', async (req, res) => {
  try {
    const stats = mlModel.getAccuracyStats()
    
    res.json({
      success: true,
      statistics: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/prediction/update-result
 * Update prediction result (for accuracy tracking)
 */
router.post('/update-result', async (req, res) => {
  try {
    const { symbol, currentPrice } = req.body
    
    if (!symbol || !currentPrice) {
      return res.status(400).json({
        success: false,
        error: 'Symbol and currentPrice are required'
      })
    }

    mlModel.updatePredictionResult(symbol, currentPrice)
    
    const stats = mlModel.getAccuracyStats()
    
    res.json({
      success: true,
      message: 'Prediction results updated',
      statistics: stats
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/prediction/batch
 * Analyze multiple stocks at once
 */
router.post('/batch', async (req, res) => {
  try {
    const { symbols } = req.body
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'symbols array is required'
      })
    }

    const results = []
    const errors = []

    for (const symbol of symbols.slice(0, 10)) { // Limit to 10 at a time
      try {
        let historicalData = historicalStore.getData(symbol)
        
        if (!historicalData || historicalData.length < 50) {
          historicalData = await historicalStore.fetchAndStore(symbol)
        }

        if (!historicalData || historicalData.length < 50) {
          errors.push({
            symbol,
            error: 'Insufficient data'
          })
          continue
        }

        const currentData = {
          price: historicalData[historicalData.length - 1]?.close || 0,
          volume: historicalData[historicalData.length - 1]?.volume || 0
        }

        const prediction = await mlModel.predictAsync({
          historicalData,
          currentData,
          symbol
        })

        results.push({
          symbol: prediction.symbol,
          action: prediction.action,
          confidence: prediction.confidence,
          currentPrice: prediction.currentPrice,
          targetPrice: prediction.targetPrice,
          stopLoss: prediction.stopLoss,
          riskRewardRatio: prediction.riskRewardRatio
        })
      } catch (error) {
        errors.push({
          symbol,
          error: error.message
        })
      }
    }

    res.json({
      success: true,
      analyzed: results.length,
      results,
      errors
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

module.exports = router
