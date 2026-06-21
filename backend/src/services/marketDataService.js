/**
 * Market Data Service
 * Fetches real-time quotes from Yahoo Finance (no API key needed)
 * Stores in local SQLite for offline access
 */

const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const { getDatabase } = require('./database');

// Yahoo Finance symbol mapping
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

// NIFTY 50 stocks
const NIFTY_50_SYMBOLS = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK',
  'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
  'AXISBANK', 'BAJFINANCE', 'MARUTI', 'ASIANPAINT', 'HINDUNILVR',
  'WIPRO', 'TITAN', 'SUNPHARMA', 'NTPC', 'TATAMOTORS',
  'TATASTEEL', 'JSWSTEEL', 'HCLTECH', 'TECHM', 'ULTRACEMCO',
  'NESTLEIND', 'COALINDIA', 'BPCL', 'ONGC', 'INDUSINDBK'
];

class MarketDataService {
  constructor() {
    this.db = getDatabase();
    this.lastFetchTime = null;
    this.cache = new Map();
  }

  /**
   * Get Yahoo Finance symbol
   */
  getYahooSymbol(symbol) {
    return YAHOO_SYMBOL_MAP[symbol.toUpperCase()] || `${symbol}.NS`;
  }

  /**
   * Fetch real-time quote for a single stock
   */
  async fetchQuote(symbol) {
    const yahooSymbol = this.getYahooSymbol(symbol);
    
    try {
      const quote = await yahooFinance.quote(yahooSymbol);
      
      if (!quote) {
        return null;
      }

      const result = {
        symbol: symbol.toUpperCase(),
        name: quote.longName || quote.shortName || symbol,
        price: quote.regularMarketPrice || 0,
        change: quote.regularMarketChange || 0,
        changePercent: quote.regularMarketChangePercent || 0,
        open: quote.regularMarketOpen || quote.regularMarketPrice,
        high: quote.regularMarketDayHigh || quote.regularMarketPrice,
        low: quote.regularMarketDayLow || quote.regularMarketPrice,
        volume: quote.regularMarketVolume || 0,
        marketCap: quote.marketCap || 0,
        pe_ratio: quote.forwardPE || quote.trailingPE || null,
        eps: quote.epsTrailingTwelveMonths || null,
        div_yield: (quote.dividendYield || 0) * 100,
        high_52w: quote.fiftyTwoWeekHigh || null,
        low_52w: quote.fiftyTwoWeekLow || null,
        avg_volume: quote.averageDailyVolume3Month || quote.regularMarketVolume || 0,
        beta: quote.beta || null,
        timestamp: new Date().toISOString()
      };

      // Store in database
      this.db.insertRealtimeQuote(result);
      
      return result;
      
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error.message);
      
      // Return cached data if available
      return this.db.getLatestQuote(symbol);
    }
  }

  /**
   * Fetch quotes for multiple stocks
   */
  async fetchQuotes(symbols) {
    const results = [];
    
    for (const symbol of symbols) {
      try {
        const quote = await this.fetchQuote(symbol);
        if (quote) {
          results.push(quote);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`Error in batch fetch for ${symbol}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Fetch all NIFTY 50 quotes
   */
  async fetchNifty50() {
    return this.fetchQuotes(NIFTY_50_SYMBOLS);
  }

  /**
   * Fetch market indices
   */
  async fetchIndices() {
    try {
      const indices = [
        { symbol: 'NIFTY_50', yahooSymbol: '^NSEI', name: 'NIFTY 50' },
        { symbol: 'NIFTY_BANK', yahooSymbol: '^NSEBANK', name: 'NIFTY BANK' },
        { symbol: 'SENSEX', yahooSymbol: '^BSESN', name: 'SENSEX' },
        { symbol: 'NIFTY_IT', yahooSymbol: '^CNXIT', name: 'NIFTY IT' },
        { symbol: 'NIFTY_MIDCAP', yahooSymbol: 'NIFTY_MIDCAP.NS', name: 'NIFTY MIDCAP' }
      ];

      const results = [];
      
      for (const index of indices) {
        try {
          const quote = await yahooFinance.quote(index.yahooSymbol);
          
          if (quote) {
            results.push({
              symbol: index.symbol,
              name: index.name,
              price: quote.regularMarketPrice || 0,
              change: quote.regularMarketChange || 0,
              changePercent: quote.regularMarketChangePercent || 0,
              high: quote.regularMarketDayHigh,
              low: quote.regularMarketDayLow,
              timestamp: new Date().toISOString()
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error) {
          console.log(`Could not fetch ${index.name}`);
        }
      }
      
      return results;
      
    } catch (error) {
      console.error('Error fetching indices:', error.message);
      return [];
    }
  }

  /**
   * Get screener data (multiple stocks with metrics)
   */
  async getScreenerData(symbols, filters = {}) {
    let stocks = [];
    
    // Fetch all quotes
    for (const symbol of symbols) {
      const quote = await this.fetchQuote(symbol);
      if (quote) {
        stocks.push(quote);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Apply filters
    if (filters.sector) {
      // Filter by sector (would need sector data from company details)
    }
    
    if (filters.minPrice) {
      stocks = stocks.filter(s => s.price >= filters.minPrice);
    }
    
    if (filters.maxPrice) {
      stocks = stocks.filter(s => s.price <= filters.maxPrice);
    }
    
    if (filters.minVolume) {
      stocks = stocks.filter(s => s.volume >= filters.minVolume);
    }
    
    if (filters.minChange) {
      stocks = stocks.filter(s => s.changePercent >= filters.minChange);
    }
    
    if (filters.maxChange) {
      stocks = stocks.filter(s => s.changePercent <= filters.maxChange);
    }
    
    // Sort
    if (filters.sortBy) {
      const sortField = filters.sortBy;
      const sortOrder = filters.sortOrder === 'desc' ? -1 : 1;
      stocks.sort((a, b) => {
        const aVal = a[sortField] || 0;
        const bVal = b[sortField] || 0;
        return (aVal > bVal ? 1 : -1) * sortOrder;
      });
    }
    
    return stocks;
  }

  /**
   * Get top gainers
   */
  async getTopGainers(symbols, limit = 10) {
    const quotes = await this.fetchQuotes(symbols);
    return quotes
      .filter(q => q.changePercent > 0)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, limit);
  }

  /**
   * Get top losers
   */
  async getTopLosers(symbols, limit = 10) {
    const quotes = await this.fetchQuotes(symbols);
    return quotes
      .filter(q => q.changePercent < 0)
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, limit);
  }

  /**
   * Get most active by volume
   */
  async getMostActive(symbols, limit = 10) {
    const quotes = await this.fetchQuotes(symbols);
    return quotes
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  }

  /**
   * Get 52-week high stocks
   */
  async get52WeekHighs(symbols) {
    const quotes = await this.fetchQuotes(symbols);
    return quotes.filter(q => 
      q.high_52w && q.price >= q.high_52w * 0.95
    );
  }

  /**
   * Get 52-week low stocks
   */
  async get52WeekLows(symbols) {
    const quotes = await this.fetchQuotes(symbols);
    return quotes.filter(q => 
      q.low_52w && q.price <= q.low_52w * 1.05
    );
  }
}

module.exports = MarketDataService;
