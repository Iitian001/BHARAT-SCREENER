/**
 * Historical Data Store
 * Bridges the prediction routes with the real HistoricalDataService + Database.
 * Keeps an in-memory cache for fast repeated access.
 */

const HistoricalDataService = require('./historicalDataService');
const { getDatabase } = require('./database');

class HistoricalDataStore {
  constructor() {
    this.cache = new Map();          // symbol → { data, timestamp }
    this.cacheExpiry = 4 * 60 * 60 * 1000; // 4 hours
    this.historicalService = null;    // lazy-init (avoids DB init at import time)
  }

  /** Lazy getter for the HistoricalDataService singleton */
  _getService() {
    if (!this.historicalService) {
      this.historicalService = new HistoricalDataService();
    }
    return this.historicalService;
  }

  /**
   * Get historical data from cache.
   * Returns null if cache miss or expired.
   */
  getData(symbol) {
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  /**
   * Store data in cache.
   */
  storeData(symbol, data) {
    this.cache.set(symbol, { data, timestamp: Date.now() });
  }

  /**
   * Fetch and store historical data for a symbol.
   * 1. Return from cache if fresh.
   * 2. Check DB for existing records.
   * 3. If DB is empty for this symbol, download via Yahoo Finance.
   * 4. Cache & return.
   */
  async fetchAndStore(symbol) {
    try {
      // 1. Cache hit?
      const cached = this.getData(symbol);
      if (cached && cached.length > 0) return cached;

      const service = this._getService();

      // 2. Check DB first
      let data = service.getStoredHistoricalData(symbol, 15);

      // 3. If not enough data in DB, fetch from Yahoo Finance
      if (!data || data.length < 50) {
        console.log(`📡 Downloading historical data for ${symbol} from Yahoo Finance…`);
        await service.fetchAndStoreHistoricalData(symbol, 15);
        data = service.getStoredHistoricalData(symbol, 15);
      }

      // Normalise to the shape the prediction engine expects
      if (data && data.length > 0) {
        const normalised = data.map(row => ({
          date: row.timestamp ? row.timestamp.split('T')[0] : row.date,
          timestamp: new Date(row.timestamp || row.date).getTime(),
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume || 0
        }));

        this.storeData(symbol, normalised);
        return normalised;
      }

      return [];
    } catch (error) {
      console.error(`Error in historicalStore.fetchAndStore(${symbol}):`, error.message);

      // Try to return whatever is in the DB even if the fetch errored
      try {
        const fallback = this._getService().getStoredHistoricalData(symbol, 15);
        if (fallback && fallback.length > 0) {
          const normalised = fallback.map(row => ({
            date: row.timestamp ? row.timestamp.split('T')[0] : row.date,
            timestamp: new Date(row.timestamp || row.date).getTime(),
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume || 0
          }));
          this.storeData(symbol, normalised);
          return normalised;
        }
      } catch (_) { /* ignore secondary error */ }

      return [];
    }
  }

  /**
   * Clear in-memory cache.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * List symbols currently in cache.
   */
  getCachedSymbols() {
    return Array.from(this.cache.keys());
  }
}

// Singleton
const historicalStore = new HistoricalDataStore();

module.exports = historicalStore;
