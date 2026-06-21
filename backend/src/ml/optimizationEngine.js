const TechnicalIndicators = require('./technicalIndicators');

class OptimizationEngine {
  constructor(historicalDataService) {
    this.histService = historicalDataService;
    this.optimizedParams = new Map(); // Store optimal weights per stock
  }

  /**
   * Backtest a simple strategy over historical data
   */
  backtestStrategy(data, weights) {
    let balance = 10000; // Starting capital
    let position = 0; // Quantity held
    let entryPrice = 0;
    
    // We need at least 50 days to calculate initial indicators
    for (let i = 50; i < data.length; i++) {
      const slice = data.slice(i - 50, i + 1);
      const currentPrice = slice[slice.length - 1].close;
      const indicators = TechnicalIndicators.calculateAll(slice);
      
      const signalData = this.generateWeightedSignal(indicators, currentPrice, weights);
      
      // Basic execution logic
      if (signalData.signal === 'BUY' && position === 0) {
        // Buy as much as possible
        position = Math.floor(balance / currentPrice);
        balance -= position * currentPrice;
        entryPrice = currentPrice;
      } else if (signalData.signal === 'SELL' && position > 0) {
        // Sell everything
        balance += position * currentPrice;
        position = 0;
      }
    }
    
    // Close any open position at the end
    if (position > 0) {
      balance += position * data[data.length - 1].close;
    }
    
    return balance;
  }

  /**
   * Generate signal using custom weights for the indicators
   */
  generateWeightedSignal(indicators, currentPrice, weights) {
    if (!indicators) return { signal: 'HOLD', confidence: 0 };

    let buyScore = 0;
    let sellScore = 0;

    // RSI
    if (indicators.rsi14) {
      if (indicators.rsi14 < 30) buyScore += weights.rsi;
      if (indicators.rsi14 > 70) sellScore += weights.rsi;
    }
    
    // MACD
    if (indicators.macd) {
      if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) buyScore += weights.macd;
      if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) sellScore += weights.macd;
    }
    
    // Bollinger
    if (indicators.bollingerBands) {
      if (currentPrice < indicators.bollingerBands.lower) buyScore += weights.bb;
      if (currentPrice > indicators.bollingerBands.upper) sellScore += weights.bb;
    }
    
    // Moving Averages
    if (indicators.sma20 && indicators.sma50) {
      if (currentPrice > indicators.sma20 && indicators.sma20 > indicators.sma50) buyScore += weights.ma;
      if (currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) sellScore += weights.ma;
    }

    const total = buyScore + sellScore;
    if (total === 0) return { signal: 'HOLD', confidence: 0 };
    
    const signal = buyScore > sellScore ? 'BUY' : sellScore > buyScore ? 'SELL' : 'HOLD';
    const confidence = (Math.max(buyScore, sellScore) / (weights.rsi + weights.macd + weights.bb + weights.ma)) * 100;

    return { signal, confidence };
  }

  /**
   * Grid Search to find the best weights for a specific stock
   */
  optimizeForStock(symbol) {
    const data = this.histService.getStoredHistoricalData(symbol, 1);
    if (!data || data.length < 100) return null; // Need enough data

    let bestBalance = 0;
    let bestWeights = { rsi: 1, macd: 1, bb: 1, ma: 1 };

    const weightOptions = [1, 2, 3]; // Test different weight importance

    // Simple grid search over possible weights
    for (const rsi of weightOptions) {
      for (const macd of weightOptions) {
        for (const bb of weightOptions) {
          for (const ma of weightOptions) {
            const weights = { rsi, macd, bb, ma };
            const finalBalance = this.backtestStrategy(data, weights);
            if (finalBalance > bestBalance) {
              bestBalance = finalBalance;
              bestWeights = weights;
            }
          }
        }
      }
    }

    const roi = ((bestBalance - 10000) / 10000) * 100;
    this.optimizedParams.set(symbol, { weights: bestWeights, historicalROI: roi });
    return { weights: bestWeights, roi };
  }

  getOptimizedWeights(symbol) {
    return this.optimizedParams.get(symbol) || { weights: { rsi: 1, macd: 1, bb: 1, ma: 1 }, historicalROI: 0 };
  }
}

module.exports = OptimizationEngine;
