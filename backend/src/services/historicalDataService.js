/**
 * Historical Data Service
 * Fetches and stores 15+ years of historical stock data locally
 * Uses Yahoo Finance (no API key needed) + Angel One if available
 */

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const { getDatabase } = require('./database');

// Map Indian stock symbols to Yahoo Finance format
const YAHOO_SYMBOL_MAP = {
  'RELIANCE': 'RELIANCE.NS',
  'TCS': 'TCS.NS',
  'INFY': 'INFY.NS',
  'HDFC': 'HDFCBANK.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'ICICIBANK': 'ICICIBANK.NS',
  'SBIN': 'SBIN.NS',
  'BHARTIARTL': 'BHARTIARTL.NS',
  'ITC': 'ITC.NS',
  'KOTAKBANK': 'KOTAKBANK.NS',
  'LT': 'LT.NS',
  'AXISBANK': 'AXISBANK.NS',
  'BAJFINANCE': 'BAJFINANCE.NS',
  'MARUTI': 'MARUTI.NS',
  'ASIANPAINT': 'ASIANPAINT.NS',
  'HINDUNILVR': 'HINDUNILVR.NS',
  'WIPRO': 'WIPRO.NS',
  'TITAN': 'TITAN.NS',
  'SUNPHARMA': 'SUNPHARMA.NS',
  'NTPC': 'NTPC.NS',
  'ADANIENT': 'ADANIENT.NS',
  'ADANIPORTS': 'ADANIPORTS.NS',
  'POWERGRID': 'POWERGRID.NS',
  'TATAMOTORS': 'TATAMOTORS.NS',
  'TATASTEEL': 'TATASTEEL.NS',
  'JSWSTEEL': 'JSWSTEEL.NS',
  'HCLTECH': 'HCLTECH.NS',
  'TECHM': 'TECHM.NS',
  'ULTRACEMCO': 'ULTRACEMCO.NS',
  'NESTLEIND': 'NESTLEIND.NS',
  'COALINDIA': 'COALINDIA.NS',
  'BPCL': 'BPCL.NS',
  'ONGC': 'ONGC.NS',
  'INDUSINDBK': 'INDUSINDBK.NS',
  'HEROMOTOCO': 'HEROMOTOCO.NS',
  'BAJAJ-AUTO': 'BAJAJ-AUTO.NS',
  'GRASIM': 'GRASIM.NS',
  'CIPLA': 'CIPLA.NS',
  'DRREDDY': 'DRREDDY.NS',
  'BRITANNIA': 'BRITANNIA.NS',
  'EICHERMOT': 'EICHERMOT.NS',
  'SHREECEM': 'SHREECEM.NS',
  'DIVISLAB': 'DIVISLAB.NS',
  'UPL': 'UPL.NS',
  'SBILIFE': 'SBILIFE.NS',
  'HDFCLIFE': 'HDFCLIFE.NS',
  'ICICIGI': 'ICICIGI.NS',
  'TATACONSUM': 'TATACONSUM.NS',
  'APOLLOHOSP': 'APOLLOHOSP.NS',
  'DMART': 'DMART.NS'
};

// Reverse map
const SYMBOL_FROM_YAHOO = Object.fromEntries(
  Object.entries(YAHOO_SYMBOL_MAP).map(([k, v]) => [v, k])
);

class HistoricalDataService {
  constructor() {
    this.db = getDatabase();
    this.cache = new Map();
  }

  /**
   * Get Yahoo Finance symbol for a stock
   */
  getYahooSymbol(symbol) {
    return YAHOO_SYMBOL_MAP[symbol.toUpperCase()] || `${symbol}.NS`;
  }

  sanitizeData(records) {
    if (!records || records.length === 0) return [];
    
    // Sort by timestamp
    records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Filter volume = 0
    let validRecords = records.filter(r => r.volume > 0);

    // Filter gaps > 20%
    let noGaps = [];
    for (let i = 0; i < validRecords.length; i++) {
      const current = validRecords[i];
      if (noGaps.length > 0) {
        const previous = noGaps[noGaps.length - 1];
        const gap = Math.abs(current.close - previous.close) / previous.close;
        if (gap > 0.20) continue;
      }
      noGaps.push(current);
    }

    // Filter flatlines (5+ days of same price)
    let finalRecords = [];
    let i = 0;
    while (i < noGaps.length) {
      let j = i + 1;
      while (j < noGaps.length && noGaps[j].close === noGaps[i].close) {
        j++;
      }
      const count = j - i;
      if (count < 5) {
        for (let k = i; k < j; k++) {
          finalRecords.push(noGaps[k]);
        }
      }
      i = j;
    }

    return finalRecords;
  }

  /**
   * Fetch and store 15+ years of historical data
   */
  async fetchAndStoreHistoricalData(symbol, years = 15) {
    console.log(`📊 Fetching ${years} years of historical data for ${symbol}...`);
    
    const yahooSymbol = this.getYahooSymbol(symbol);
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    
    try {
      // Use historical API for data (it includes adjClose)
      const result = await yahooFinance.historical(yahooSymbol, {
        period1: startDate.toISOString().split('T')[0],
        period2: new Date().toISOString().split('T')[0],
        interval: '1d'
      });

      if (!result || result.length === 0) {
        console.warn(`No historical data found for ${symbol}`);
        return { success: false, symbol, error: 'No data found' };
      }

      // Transform and store in database using adjClose
      // Note: adjclose adjustment factors change retroactively as new dividends/splits occur, 
      // meaning identical date ranges can produce different numbers run-to-run.
      let records = result
        .filter(quote => quote.close != null)
        .map(quote => {
          const adjRatio = quote.adjClose && quote.close ? quote.adjClose / quote.close : 1;
          return {
            symbol: symbol.toUpperCase(),
            timestamp: new Date(quote.date).toISOString(),
            open: (quote.open || quote.close) * adjRatio,
            high: (quote.high || quote.close) * adjRatio,
            low: (quote.low || quote.close) * adjRatio,
            close: quote.adjClose || quote.close,
            volume: quote.volume || 0,
            timeframe: '1d'
          };
        });

      records = this.sanitizeData(records);

      if (records.length > 0) {
        this.db.bulkInsertPriceHistory(records);
        console.log(`✅ Stored ${records.length} historical records for ${symbol}`);
      }

      return { 
        success: true, 
        symbol, 
        recordsStored: records.length,
        earliestDate: records[0]?.timestamp,
        latestDate: records[records.length - 1]?.timestamp
      };
      
    } catch (error) {
      console.error(`❌ Error fetching historical data for ${symbol}:`, error.message);
      return { success: false, symbol, error: error.message };
    }
  }

  sanitizeData(records) {
    if (!records || records.length === 0) return [];
    
    // Sort records chronologically (oldest first)
    const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const sanitized = [];
    let samePriceCount = 1;
    let prevClose = null;

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      
      // Filter out 0 volume
      if (record.volume === 0) continue;
      
      if (prevClose !== null) {
        // Price gap > 20%
        const gap = Math.abs(record.close - prevClose) / prevClose;
        if (gap > 0.20) {
          continue; 
        }

        // Price doesn't move
        if (record.close === prevClose) {
          samePriceCount++;
        } else {
          samePriceCount = 1;
        }

        if (samePriceCount >= 5) {
          continue;
        }
      }

      sanitized.push(record);
      prevClose = record.close;
    }

    return sanitized;
  }

  /**
   * Fetch historical indices data (NIFTY 50, INDIAVIX)
   */
  async fetchAndStoreIndicesHistory(years = 15) {
    console.log(`📊 Fetching indices history...`);
    const indices = ['^NSEI', '^INDIAVIX', '^CNXIT', '^CNXAUTO', '^CNXBANK', '^CNXPHARMA', '^CNXFMCG'];
    
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);

    for (const indexSymbol of indices) {
      try {
        const result = await yahooFinance.historical(indexSymbol, {
          period1: startDate.toISOString().split('T')[0],
          period2: new Date().toISOString().split('T')[0],
          interval: '1d'
        });

        if (result && result.length > 0) {
          const records = result
            .filter(quote => quote.close != null)
            .map(quote => ({
              symbol: indexSymbol === '^NSEI' ? 'NIFTY50' : (indexSymbol === '^INDIAVIX' ? 'INDIAVIX' : indexSymbol.replace('^', '')),
              timestamp: new Date(quote.date).toISOString(),
              open: quote.open || quote.close,
              high: quote.high || quote.close,
              low: quote.low || quote.close,
              close: quote.close, // Indices typically don't have adjClose adjustments like stocks
              volume: quote.volume || 0
            }));
          
          this.db.saveIndexHistory(records[0].symbol, records);
          console.log(`✅ Stored ${records.length} records for ${indexSymbol}`);
        }
      } catch (err) {
        console.error(`❌ Error fetching ${indexSymbol}:`, err.message);
      }
    }
  }

  /**
   * Fetch Earnings Calendar Date
   */
  async fetchEarningsDate(symbol) {
    try {
      const yahooSymbol = this.getYahooSymbol(symbol);
      const quote = await yahooFinance.quote(yahooSymbol);
      if (quote && quote.earningsTimestamp) {
        return { symbol, earningsDate: new Date(quote.earningsTimestamp).toISOString(), is_mocked: false };
      }
      return { symbol, earningsDate: null, is_mocked: false };
    } catch (err) {
      // Mock it if API fails to prevent blocking
      const mockDate = new Date();
      mockDate.setDate(mockDate.getDate() + Math.floor(Math.random() * 60)); // Random day in next 2 months
      return { symbol, earningsDate: mockDate.toISOString(), is_mocked: true };
    }
  }

  /**
   * Fetch historical data for multiple stocks (batch)
   */
  async batchFetchHistoricalData(symbols, years = 15) {
    console.log(`📊 Starting batch historical data fetch for ${symbols.length} stocks...`);
    
    const results = [];
    let totalStored = 0;
    
    for (const symbol of symbols) {
      try {
        const result = await this.fetchAndStoreHistoricalData(symbol, years);
        results.push(result);
        
        if (result.success) {
          totalStored += result.recordsStored;
        }
        
        // Rate limiting - wait between requests
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        results.push({ success: false, symbol, error: error.message });
      }
    }
    
    console.log(`\n✅ Batch complete: ${totalStored} records stored for ${results.filter(r => r.success).length}/${symbols.length} stocks`);
    return results;
  }

  /**
   * Fetch intraday data (1-minute candles)
   */
  async fetchIntradayData(symbol) {
    const yahooSymbol = this.getYahooSymbol(symbol);
    
    try {
      const result = await yahooFinance.chart(yahooSymbol, {
        period1: new Date().toISOString().split('T')[0],
        interval: '1m'
      });

      if (!result || !result.quotes) {
        return [];
      }

      return result.quotes.map(quote => ({
        symbol: symbol.toUpperCase(),
        timestamp: new Date(quote.date).toISOString(),
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
        volume: quote.volume,
        vwap: null
      }));
      
    } catch (error) {
      console.error(`Error fetching intraday for ${symbol}:`, error.message);
      return [];
    }
  }

  /**
   * Get stored historical data from database
   */
  getStoredHistoricalData(symbol, years = 15) {
    return this.db.getPriceHistory(symbol, { days: years * 365, timeframe: '1d' });
  }

  /**
   * Get all available years for a symbol
   */
  getAvailableYears(symbol) {
    const history = this.db.getPriceHistory(symbol, { timeframe: '1d' });
    if (history.length === 0) return [];
    
    const years = new Set();
    history.forEach(record => {
      const year = new Date(record.timestamp).getFullYear();
      years.add(year);
    });
    
    return Array.from(years).sort();
  }

  /**
   * Calculate statistics for historical data
   */
  calculateHistoricalStats(symbol) {
    const history = this.db.getPriceHistory(symbol, { timeframe: '1d' });
    
    if (history.length === 0) {
      return null;
    }
    
    // Sort by date
    history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const firstPrice = history[0].close;
    const lastPrice = history[history.length - 1].close;
    const yearsDiff = (new Date(history[history.length - 1].timestamp) - new Date(history[0].timestamp)) 
                      / (1000 * 60 * 60 * 24 * 365);
    
    // Calculate CAGR
    const cagr = (Math.pow(lastPrice / firstPrice, 1 / yearsDiff) - 1) * 100;
    
    // Calculate volatility (annualized)
    const returns = [];
    for (let i = 1; i < history.length; i++) {
      returns.push((history[i].close - history[i - 1].close) / history[i - 1].close);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100; // Annualized
    
    // Find max drawdown
    let maxPrice = history[0].close;
    let maxDrawdown = 0;
    history.forEach(h => {
      if (h.close > maxPrice) maxPrice = h.close;
      const drawdown = (maxPrice - h.close) / maxPrice * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });
    
    // All-time high and low
    const allTimeHigh = Math.max(...history.map(h => h.high));
    const allTimeLow = Math.min(...history.map(h => h.low));
    
    return {
      symbol,
      dataPoints: history.length,
      earliestDate: history[0].timestamp,
      latestDate: history[history.length - 1].timestamp,
      years: yearsDiff.toFixed(2),
      startPrice: firstPrice,
      currentPrice: lastPrice,
      totalReturn: ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2),
      cagr: cagr.toFixed(2),
      volatility: volatility.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      allTimeHigh,
      allTimeLow,
      distance: {
        fromHigh: ((lastPrice - allTimeHigh) / allTimeHigh * 100).toFixed(2),
        fromLow: ((lastPrice - allTimeLow) / allTimeLow * 100).toFixed(2)
      }
    };
  }

  /**
   * Initialize historical data for tracked stocks
   */
  async initializeHistoricalData(symbols) {
    console.log('\n🚀 Initializing historical data for tracked stocks...\n');
    
    const results = await this.batchFetchHistoricalData(symbols, 15);
    
    const summary = {
      total: symbols.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalRecords: results.reduce((sum, r) => sum + (r.recordsStored || 0), 0)
    };
    
    console.log('\n📊 Historical Data Initialization Summary:');
    console.log(`   Total Stocks: ${summary.total}`);
    console.log(`   Successful: ${summary.success}`);
    console.log(`   Failed: ${summary.failed}`);
    console.log(`   Total Records: ${summary.totalRecords.toLocaleString()}`);
    
    return summary;
  }

  /**
   * Update today's data for all tracked stocks
   */
  async updateTodayData(symbols) {
    console.log('📦 Updating today\'s data for tracked stocks...');
    
    let updated = 0;
    
    for (const symbol of symbols) {
      try {
        const yahooSymbol = this.getYahooSymbol(symbol);
        const quote = await yahooFinance.quote(yahooSymbol);
        
        if (quote) {
          const record = {
            symbol: symbol.toUpperCase(),
            timestamp: new Date().toISOString(),
            open: quote.regularMarketOpen || quote.regularMarketPrice,
            high: quote.regularMarketDayHigh || quote.regularMarketPrice,
            low: quote.regularMarketDayLow || quote.regularMarketPrice,
            close: quote.regularMarketPrice,
            volume: quote.regularMarketVolume || 0,
            timeframe: '1d'
          };
          
          this.db.insertPriceHistory(record);
          updated++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`Error updating ${symbol}:`, error.message);
      }
    }
    
    console.log(`✅ Updated ${updated} stocks`);
    return updated;
  }

  getAllCachedSymbols() {
    const stmt = this.db.db.prepare(`
      SELECT symbol, COUNT(*) as cnt, MAX(timestamp) as latest 
      FROM price_history 
      WHERE timeframe = '1d' 
      GROUP BY symbol 
    `);
    return stmt.all();
  }

  getLatestPricesMap() {
    try {
      const stmt = this.db.db.prepare(`
        SELECT symbol, close 
        FROM price_history 
        WHERE (symbol, timestamp) IN (
          SELECT symbol, MAX(timestamp) 
          FROM price_history 
          GROUP BY symbol
        )
      `);
      const results = stmt.all();
      const priceMap = new Map();
      for (const r of results) {
        priceMap.set(r.symbol, r.close);
      }
      return priceMap;
    } catch (err) {
      console.warn('Could not load latest prices map:', err.message);
      return new Map();
    }
  }

  getStaleSymbols(maxAgeHours = 24) {
    const stmt = this.db.db.prepare(`
      SELECT symbol, MAX(timestamp) as latest 
      FROM price_history 
      WHERE timeframe = '1d' 
      GROUP BY symbol 
      HAVING datetime(latest) < datetime('now', '-' || ? || ' hours')
    `);
    return stmt.all(maxAgeHours);
  }

  async preloadAllStocks(scripList, progressCallback) {
    // First fetch index history
    await this.fetchAndStoreIndicesHistory(15);
    
    const total = scripList.length;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const batchSize = 3;

    for (let i = 0; i < total; i += batchSize) {
      const batch = scripList.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (symbol) => {
        try {
          // Skip if we already have fresh data
          const existing = this.getStoredHistoricalData(symbol, 1);
          if (existing && existing.length >= 50) {
            succeeded++;
            completed++;
            return;
          }
          await this.fetchAndStoreHistoricalData(symbol, 1);
          const stored = this.getStoredHistoricalData(symbol, 1);
          if (stored && stored.length >= 50) succeeded++;
          else failed++;
        } catch (err) {
          failed++;
        }
        completed++;
      }));

      if (progressCallback) {
        progressCallback({ total, completed, succeeded, failed });
      }

      // Rate limit: 500ms pause between batches to avoid Yahoo Finance throttling
      await new Promise(r => setTimeout(r, 500));
    }

    return { total, completed, succeeded, failed };
  }
}

module.exports = HistoricalDataService;
