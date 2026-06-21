/**
 * Technical Indicators Calculator
 * Uses 'technicalindicators' npm package for calculations
 */

const SMA = require('technicalindicators').SMA
const EMA = require('technicalindicators').EMA
const RSI = require('technicalindicators').RSI
const MACD = require('technicalindicators').MACD
const BollingerBands = require('technicalindicators').BollingerBands
const ATR = require('technicalindicators').ATR
const Stochastic = require('technicalindicators').Stochastic
const ADX = require('technicalindicators').ADX

class TechnicalIndicators {
  
  /**
   * Calculate all indicators from OHLCV data
   * @param {Array} data - Array of { high, low, close, open, volume }
   */
  static calculateAll(data) {
    if (!data || data.length < 14) {
      return null
    }

    const closes = data.map(d => d.close)
    const highs = data.map(d => d.high)
    const lows = data.map(d => d.low)
    const volumes = data.map(d => d.volume || 0)

    return {
      // Moving Averages
      sma20: this.SMA(closes, 20),
      sma50: this.SMA(closes, 50),
      sma200: this.SMA(closes, 200),
      ema12: this.EMA(closes, 12),
      ema26: this.EMA(closes, 26),
      
      // Oscillators
      rsi14: this.RSI(closes, 14),
      stochastic: this.Stochastic(highs, lows, closes),
      
      // Trend Indicators
      macd: this.MACD(closes),
      adx: this.ADX(highs, lows, closes),
      
      // Volatility
      bollingerBands: this.BollingerBands(closes),
      atr14: this.ATR(highs, lows, closes, 14),
      
      // Volume Analysis
      volumeSMA20: this.SMA(volumes, 20),
      
      // Support & Resistance (using recent highs/lows)
      supportResistance: this.calculateSupportResistance(highs, lows, closes)
    }
  }

  /**
   * Simple Moving Average
   */
  static SMA(values, period) {
    try {
      const result = SMA.calculate({ values, period })
      return result.length > 0 ? result[result.length - 1] : null
    } catch (e) {
      return null
    }
  }

  /**
   * Exponential Moving Average
   */
  static EMA(values, period) {
    try {
      const result = EMA.calculate({ values, period })
      return result.length > 0 ? result[result.length - 1] : null
    } catch (e) {
      return null
    }
  }

  /**
   * Relative Strength Index
   */
  static RSI(values, period = 14) {
    try {
      const result = RSI.calculate({ values, period })
      return result.length > 0 ? result[result.length - 1] : null
    } catch (e) {
      return null
    }
  }

  /**
   * MACD
   */
  static MACD(values) {
    try {
      const result = MACD.calculate({
        values,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      })
      if (result.length > 0) {
        const latest = result[result.length - 1]
        return {
          macd: latest.MACD,
          signal: latest.signal,
          histogram: latest.histogram
        }
      }
      return null
    } catch (e) {
      return null
    }
  }

  /**
   * Bollinger Bands
   */
  static BollingerBands(values, period = 20) {
    try {
      const result = BollingerBands.calculate({
        values,
        period,
        stdDev: 2
      })
      if (result.length > 0) {
        const latest = result[result.length - 1]
        return {
          upper: latest.upper,
          middle: latest.middle,
          lower: latest.lower,
          pb: latest.pb // %B - where price is relative to bands
        }
      }
      return null
    } catch (e) {
      return null
    }
  }

  /**
   * Average True Range (Volatility)
   */
  static ATR(highs, lows, closes, period = 14) {
    try {
      const result = ATR.calculate({ high: highs, low: lows, close: closes, period })
      return result.length > 0 ? result[result.length - 1] : null
    } catch (e) {
      return null
    }
  }

  /**
   * Stochastic Oscillator
   */
  static Stochastic(highs, lows, closes) {
    try {
      const result = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
        signalPeriod: 3
      })
      if (result.length > 0) {
        const latest = result[result.length - 1]
        return {
          k: latest.k,  // %K - current position
          d: latest.d   // %D - signal line
        }
      }
      return null
    } catch (e) {
      return null
    }
  }

  /**
   * Average Directional Index (Trend Strength)
   */
  static ADX(highs, lows, closes) {
    try {
      const result = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14
      })
      if (result.length > 0) {
        const latest = result[result.length - 1]
        return {
          adx: latest.adx,
          pdi: latest.pdi, // +DI
          mdi: latest.mdi  // -DI
        }
      }
      return null
    } catch (e) {
      return null
    }
  }

  /**
   * Calculate Support and Resistance levels
   */
  static calculateSupportResistance(highs, lows, closes, lookback = 20) {
    const recentHighs = highs.slice(-lookback)
    const recentLows = lows.slice(-lookback)
    const currentPrice = closes[closes.length - 1]

    // Find pivot points (Fractal method)
    const resistance = Math.max(...recentHighs)
    const support = Math.min(...recentLows)

    // Find other resistance/support levels
    const sortedHighs = [...recentHighs].sort((a, b) => b - a)
    const sortedLows = [...recentLows].sort((a, b) => a - b)

    return {
      resistance: [
        { level: sortedHighs[0], type: 'R1' },
        { level: sortedHighs[1] || sortedHighs[0], type: 'R2' },
        { level: sortedHighs[2] || sortedHighs[1] || sortedHighs[0], type: 'R3' }
      ].filter(r => r.level > currentPrice),
      support: [
        { level: sortedLows[0], type: 'S1' },
        { level: sortedLows[1] || sortedLows[0], type: 'S2' },
        { level: sortedLows[2] || sortedLows[1] || sortedLows[0], type: 'S3' }
      ].filter(s => s.level < currentPrice),
      distanceToResistance: ((resistance - currentPrice) / currentPrice) * 100,
      distanceToSupport: ((currentPrice - support) / currentPrice) * 100
    }
  }

  /**
   * Generate trading signal from indicators
   */
  static generateSignal(indicators, currentPrice) {
    if (!indicators) return { signal: 'HOLD', confidence: 0, reasons: ['Insufficient data'] }

    let buySignals = 0
    let sellSignals = 0
    const reasons = []

    // RSI Analysis
    if (indicators.rsi14 !== null) {
      if (indicators.rsi14 < 30) {
        buySignals += 2
        reasons.push(`RSI oversold (${indicators.rsi14.toFixed(2)})`)
      } else if (indicators.rsi14 > 70) {
        sellSignals += 2
        reasons.push(`RSI overbought (${indicators.rsi14.toFixed(2)})`)
      } else if (indicators.rsi14 < 45) {
        buySignals += 1
        reasons.push('RSI approaching oversold')
      } else if (indicators.rsi14 > 55) {
        sellSignals += 1
        reasons.push('RSI approaching overbought')
      }
    }

    // MACD Analysis
    if (indicators.macd) {
      if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) {
        buySignals += 2
        reasons.push('MACD bullish crossover')
      } else if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) {
        sellSignals += 2
        reasons.push('MACD bearish crossover')
      }
    }

    // Bollinger Bands Analysis
    if (indicators.bollingerBands) {
      if (currentPrice < indicators.bollingerBands.lower) {
        buySignals += 2
        reasons.push('Price below lower Bollinger Band')
      } else if (currentPrice > indicators.bollingerBands.upper) {
        sellSignals += 2
        reasons.push('Price above upper Bollinger Band')
      }
    }

    // Stochastic Analysis
    if (indicators.stochastic) {
      if (indicators.stochastic.k < 20 && indicators.stochastic.d < 20) {
        buySignals += 1
        reasons.push('Stochastic oversold')
      } else if (indicators.stochastic.k > 80 && indicators.stochastic.d > 80) {
        sellSignals += 1
        reasons.push('Stochastic overbought')
      }
    }

    // Moving Average Analysis
    if (indicators.sma20 && indicators.sma50 && currentPrice) {
      if (currentPrice > indicators.sma20 && indicators.sma20 > indicators.sma50) {
        buySignals += 1
        reasons.push('Price above SMA20 & SMA50 (uptrend)')
      } else if (currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) {
        sellSignals += 1
        reasons.push('Price below SMA20 & SMA50 (downtrend)')
      }
    }

    // ADX Trend Strength
    if (indicators.adx && indicators.adx.adx > 25) {
      if (indicators.adx.pdi > indicators.adx.mdi) {
        buySignals += 1
        reasons.push('Strong uptrend (ADX > 25, +DI > -DI)')
      } else {
        sellSignals += 1
        reasons.push('Strong downtrend (ADX > 25, -DI > +DI)')
      }
    }

    // Support/Resistance
    if (indicators.supportResistance) {
      const sr = indicators.supportResistance
      if (sr.distanceToSupport < 2) {
        buySignals += 1
        reasons.push('Near support level')
      }
      if (sr.distanceToResistance < 2) {
        sellSignals += 1
        reasons.push('Near resistance level')
      }
    }

    // Determine overall signal
    const totalSignals = Math.max(1, buySignals + sellSignals)
    const signal = buySignals > sellSignals ? 'BUY' : sellSignals > buySignals ? 'SELL' : 'HOLD'
    const confidence = Math.round((Math.abs(buySignals - sellSignals) / totalSignals) * 100)

    return {
      signal,
      confidence: Math.min(confidence, 100),
      buyScore: buySignals,
      sellScore: sellSignals,
      reasons: reasons.length > 0 ? reasons : ['Neutral market conditions']
    }
  }

  /**
   * Calculate realistic target price based on volatility and trend strength
   */
  static calculateTargetPrice(indicators, currentPrice, signal) {
    if (!indicators || signal === 'SELL') return currentPrice * 0.95;
    
    let targetPrice = currentPrice * 1.05; // Fallback 5%
    let maxTarget = currentPrice;

    // 1. Volatility Target (ATR based)
    if (indicators.atr14) {
      // If trend is strong (ADX > 25), aim for 3x ATR, else 1.5x ATR
      const multiplier = (indicators.adx && indicators.adx.adx > 25) ? 3 : 1.5;
      const atrTarget = currentPrice + (indicators.atr14 * multiplier);
      maxTarget = Math.max(maxTarget, atrTarget);
    }

    // 2. Resistance Level Target
    if (indicators.supportResistance && indicators.supportResistance.resistance.length > 0) {
      const nextResistance = indicators.supportResistance.resistance[0].level;
      if (nextResistance > currentPrice) {
        maxTarget = Math.max(maxTarget, nextResistance);
      }
    }

    // 3. Bollinger Band Target
    if (indicators.bollingerBands && indicators.bollingerBands.upper > currentPrice) {
      maxTarget = Math.max(maxTarget, indicators.bollingerBands.upper);
    }

    if (maxTarget > currentPrice) {
      targetPrice = maxTarget;
    }

    // Ensure we don't project absurd returns (> 25% short term)
    const maxReturnLimit = currentPrice * 1.25;
    return Math.min(targetPrice, maxReturnLimit);
  }
}

module.exports = TechnicalIndicators
