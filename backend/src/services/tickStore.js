/**
 * In-Memory Tick Store
 * Stores real-time tick data for each stock
 */

class TickStore {
  constructor(maxTicksPerStock = 1000) {
    this.ticks = new Map() // symbol -> Array of tick data
    this.latestPrices = new Map() // symbol -> latest price
    this.maxTicksPerStock = maxTicksPerStock
  }

  /**
   * Add tick data for a stock
   */
  addTick(symbol, tickData) {
    if (!this.ticks.has(symbol)) {
      this.ticks.set(symbol, [])
    }

    const ticks = this.ticks.get(symbol)
    ticks.push({
      ...tickData,
      timestamp: tickData.timestamp || Date.now()
    })

    // Keep only last N ticks
    if (ticks.length > this.maxTicksPerStock) {
      ticks.shift()
    }

    // Update latest price
    this.latestPrices.set(symbol, tickData.ltP || tickData.ltp || tickData.price)
  }

  /**
   * Get all ticks for a symbol
   */
  getTicks(symbol, limit = 100) {
    const ticks = this.ticks.get(symbol) || []
    if (limit === -1) return ticks
    return ticks.slice(-limit)
  }

  /**
   * Get latest price for a symbol
   */
  getLatestPrice(symbol) {
    return this.latestPrices.get(symbol) || null
  }

  /**
   * Get all latest prices
   */
  getAllLatestPrices() {
    const prices = {}
    this.latestPrices.forEach((price, symbol) => {
      prices[symbol] = price
    })
    return prices
  }

  /**
   * Get price history (for charts)
   */
  getPriceHistory(symbol, limit = 100) {
    const ticks = this.getTicks(symbol, limit)
    return ticks.map(tick => ({
      time: tick.timestamp,
      price: tick.ltP || tick.ltp || tick.price,
      volume: tick.vol || tick.volume || 0,
      high: tick.high || tick.ltP || tick.ltp,
      low: tick.low || tick.ltP || tick.ltp,
      open: tick.open || tick.ltP || tick.ltp,
      close: tick.ltP || tick.ltp
    }))
  }

  /**
   * Get OHLCV data (candles) from ticks
   * @param {String} symbol - Stock symbol
   * @param {Number} intervalSeconds - Candle interval in seconds (e.g., 60 for 1-min candles)
   * @param {Number} limit - Number of candles to return
   */
  getOHLCV(symbol, intervalSeconds = 60, limit = 100) {
    const ticks = this.getTicks(symbol, -1)
    if (ticks.length === 0) return []

    const candles = []
    let currentCandle = null
    let currentInterval = null

    for (const tick of ticks) {
      const tickInterval = Math.floor(tick.timestamp / 1000 / intervalSeconds)
      const price = tick.ltP || tick.ltp || tick.price

      if (currentInterval !== tickInterval) {
        if (currentCandle) {
          candles.push(currentCandle)
        }
        currentInterval = tickInterval
        currentCandle = {
          time: tickInterval * intervalSeconds,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: tick.vol || tick.volume || 0
        }
      } else {
        currentCandle.high = Math.max(currentCandle.high, price)
        currentCandle.low = Math.min(currentCandle.low, price)
        currentCandle.close = price
        currentCandle.volume += tick.vol || tick.volume || 0
      }
    }

    if (currentCandle) {
      candles.push(currentCandle)
    }

    return candles.slice(-limit)
  }

  /**
   * Clear all data
   */
  clear() {
    this.ticks.clear()
    this.latestPrices.clear()
  }

  /**
   * Clear data for specific symbol
   */
  clearSymbol(symbol) {
    this.ticks.delete(symbol)
    this.latestPrices.delete(symbol)
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalSymbols: this.ticks.size,
      totalTicks: Array.from(this.ticks.values()).reduce((sum, arr) => sum + arr.length, 0),
      maxTicksPerStock: this.maxTicksPerStock
    }
  }
}

// Singleton instance
const tickStore = new TickStore()

module.exports = tickStore
