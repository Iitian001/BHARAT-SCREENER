/**
 * Price History Store
 * Stores price history for chart visualization
 * In-memory storage with configurable history depth
 */

class PriceStore {
  constructor(maxHistoryPerStock = 100) {
    this.priceHistory = new Map(); // symbol -> [{price, timestamp, ...}]
    this.maxHistoryPerStock = maxHistoryPerStock;
    this.currentPrices = new Map(); // symbol -> latest price data
  }

  /**
   * Update price for a stock
   */
  updatePrice(symbol, priceData) {
    // Update current price
    this.currentPrices.set(symbol, {
      ...priceData,
      timestamp: Date.now()
    });
    
    // Add to price history
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    
    const history = this.priceHistory.get(symbol);
    history.push({
      price: priceData.price,
      volume: priceData.volume || 0,
      timestamp: Date.now(),
      change: priceData.change || 0,
      changePercent: priceData.changePercent || 0
    });
    
    // Trim history to max depth
    if (history.length > this.maxHistoryPerStock) {
      this.priceHistory.set(symbol, history.slice(-this.maxHistoryPerStock));
    }
  }

  /**
   * Get current price for a stock
   */
  getCurrentPrice(symbol) {
    return this.currentPrices.get(symbol);
  }

  /**
   * Get all current prices
   */
  getAllCurrentPrices() {
    return Array.from(this.currentPrices.values());
  }

  /**
   * Get price history for a stock
   */
  getPriceHistory(symbol, maxPoints = 100) {
    const history = this.priceHistory.get(symbol) || [];
    return history.slice(-maxPoints);
  }

  /**
   * Get price history in OHLCV format (for charts)
   */
  getOHLCVHistory(symbol, interval = '1min') {
    const history = this.priceHistory.get(symbol) || [];
    
    // Group by interval
    // For now, return raw data
    return history.map((item, index) => ({
      time: new Date(item.timestamp).toISOString(),
      timestamp: item.timestamp,
      value: item.price,
      volume: item.volume
    }));
  }

  /**
   * Clear old history (cleanup)
   */
  clearOldData(maxAgeMs = 30 * 60 * 1000) { // 30 minutes default
    const cutoff = Date.now() - maxAgeMs;
    
    for (const [symbol, history] of this.priceHistory) {
      const filtered = history.filter(item => item.timestamp >= cutoff);
      this.priceHistory.set(symbol, filtered);
    }
  }

  /**
   * Get statistics for a stock
   */
  getStats(symbol) {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length === 0) return null;
    
    const prices = history.map(h => h.price);
    const volumes = history.map(h => h.volume).filter(v => v > 0);
    
    return {
      symbol: symbol,
      count: history.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
      totalVolume: volumes.reduce((sum, v) => sum + v, 0),
      firstTimestamp: history[0]?.timestamp,
      lastTimestamp: history[history.length - 1]?.timestamp
    };
  }

  /**
   * Export all data (for persistence)
   */
  export() {
    return {
      priceHistory: Object.fromEntries(this.priceHistory),
      currentPrices: Object.fromEntries(this.currentPrices),
      exportedAt: Date.now()
    };
  }

  /**
   * Import data (for persistence)
   */
  import(data) {
    if (data.priceHistory) {
      this.priceHistory = new Map(Object.entries(data.priceHistory));
    }
    if (data.currentPrices) {
      this.currentPrices = new Map(Object.entries(data.currentPrices));
    }
  }

  /**
   * Clear all data
   */
  clear() {
    this.priceHistory.clear();
    this.currentPrices.clear();
  }
}

// Export singleton instance
const priceStore = new PriceStore(200);

module.exports = {
  PriceStore,
  priceStore
};
