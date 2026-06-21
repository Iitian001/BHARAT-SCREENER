/**
 * Company Details Service
 * Fetches company information from Yahoo Finance + local storage
 * All data stored locally in SQLite
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

// Sector mapping based on symbol
const SECTOR_MAP = {
  'RELIANCE': { sector: 'Energy', industry: 'Oil & Gas' },
  'TCS': { sector: 'Technology', industry: 'IT Services' },
  'INFY': { sector: 'Technology', industry: 'IT Services' },
  'HDFCBANK': { sector: 'Financial Services', industry: 'Banking' },
  'ICICIBANK': { sector: 'Financial Services', industry: 'Banking' },
  'SBIN': { sector: 'Financial Services', industry: 'Banking' },
  'AXISBANK': { sector: 'Financial Services', industry: 'Banking' },
  'KOTAKBANK': { sector: 'Financial Services', industry: 'Banking' },
  'INDUSINDBK': { sector: 'Financial Services', industry: 'Banking' },
  'BAJFINANCE': { sector: 'Financial Services', industry: 'Consumer Finance' },
  'HINDUNILVR': { sector: 'Consumer Staples', industry: 'FMCG' },
  'ITC': { sector: 'Consumer Staples', industry: 'FMCG' },
  'NESTLEIND': { sector: 'Consumer Staples', industry: 'FMCG' },
  'BRITANNIA': { sector: 'Consumer Staples', industry: 'FMCG' },
  'ASIANPAINT': { sector: 'Consumer Durables', industry: 'Paints' },
  'TITAN': { sector: 'Consumer Durables', industry: 'Jewelry & Watches' },
  'MARUTI': { sector: 'Automobile', industry: 'Passenger Cars' },
  'TATAMOTORS': { sector: 'Automobile', industry: 'Auto Manufacturing' },
  'HEROMOTOCO': { sector: 'Automobile', industry: 'Two Wheelers' },
  'BAJAJ-AUTO': { sector: 'Automobile', industry: 'Two Wheelers' },
  'EICHERMOT': { sector: 'Automobile', industry: 'Commercial Vehicles' },
  'TATASTEEL': { sector: 'Metals', industry: 'Steel' },
  'JSWSTEEL': { sector: 'Metals', industry: 'Steel' },
  'SUNPHARMA': { sector: 'Healthcare', industry: 'Pharmaceuticals' },
  'DRREDDY': { sector: 'Healthcare', industry: 'Pharmaceuticals' },
  'CIPLA': { sector: 'Healthcare', industry: 'Pharmaceuticals' },
  'DIVISLAB': { sector: 'Healthcare', industry: 'Pharmaceuticals' },
  'APOLLOHOSP': { sector: 'Healthcare', industry: 'Hospitals' },
  'BHARTIARTL': { sector: 'Communication', industry: 'Telecom' },
  'WIPRO': { sector: 'Technology', industry: 'IT Services' },
  'HCLTECH': { sector: 'Technology', industry: 'IT Services' },
  'TECHM': { sector: 'Technology', industry: 'IT Services' },
  'LT': { sector: 'Capital Goods', industry: 'Engineering & Construction' },
  'NTPC': { sector: 'Utilities', industry: 'Power' },
  'POWERGRID': { sector: 'Utilities', industry: 'Power' },
  'ONGC': { sector: 'Energy', industry: 'Oil & Gas' },
  'BPCL': { sector: 'Energy', industry: 'Oil & Gas' },
  'COALINDIA': { sector: 'Mining', industry: 'Coal' },
  'GRASIM': { sector: 'Materials', industry: 'Cement & Fibers' },
  'ULTRACEMCO': { sector: 'Materials', industry: 'Cement' },
  'SHREECEM': { sector: 'Materials', industry: 'Cement' },
  'ADANIENT': { sector: 'Conglomerate', industry: 'Diversified' },
  'ADANIPORTS': { sector: 'Infrastructure', industry: 'Ports' }
};

class CompanyDetailsService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Get Yahoo Finance symbol
   */
  getYahooSymbol(symbol) {
    return YAHOO_SYMBOL_MAP[symbol.toUpperCase()] || `${symbol}.NS`;
  }

  /**
   * Fetch company details from Yahoo Finance and store locally
   */
  async fetchAndStoreCompanyDetails(symbol) {
    const yahooSymbol = this.getYahooSymbol(symbol);
    
    try {
      console.log(`🔍 Fetching company details for ${symbol}...`);
      
      // Fetch quote and summary data
      const [quote, summary] = await Promise.all([
        yahooFinance.quote(yahooSymbol).catch(() => null),
        yahooFinance.quoteSummary(yahooSymbol, {
          modules: ['summaryProfile', 'financialData', 'defaultKeyStatistics', 'price']
        }).catch(() => null)
      ]);

      const details = {
        symbol: symbol.toUpperCase(),
        name: quote?.longName || quote?.shortName || summary?.price?.shortName || symbol,
        ...(SECTOR_MAP[symbol.toUpperCase()] || { sector: 'Unknown', industry: 'Unknown' }),
        exchange: 'NSE',
        market_cap: summary?.price?.marketCap || quote?.marketCap || 0,
        pe_ratio: summary?.summaryProfile?.forwardPE || quote?.forwardPE || null,
        pb_ratio: summary?.defaultKeyStatistics?.priceToBook || null,
        dividend_yield: (summary?.summaryProfile?.dividendYield || 0) * 100 || (quote?.trailingAnnualDividendYield ? quote?.trailingAnnualDividendYield * 100 : 0),
        roe: summary?.financialData?.returnOnEquity * 100 || null,
        roce: summary?.financialData?.returnOnAssets * 100 || null,
        face_value: null, 
        book_value: summary?.defaultKeyStatistics?.bookValue || quote?.bookValue || null,
        eps: summary?.defaultKeyStatistics?.trailingEps || quote?.epsTrailingTwelveMonths || null,
        revenue: summary?.financialData?.totalRevenue || null,
        profit: summary?.financialData?.netIncomeToCommon || null,
        debt_equity: summary?.financialData?.debtToEquity || null,
        promoter_holding: null,
        fii_holding: null,
        dii_holding: null,
        public_holding: null,
        about: summary?.summaryProfile?.longBusinessSummary || quote?.longBusinessSummary || 'Company details not available.',
        website: summary?.summaryProfile?.website || null,
        isin: null,
        listing_date: null,
        high_52w: quote?.fiftyTwoWeekHigh || summary?.price?.fiftyTwoWeekHigh || null,
        low_52w: quote?.fiftyTwoWeekLow || summary?.price?.fiftyTwoWeekLow || null
      };

      // Store in database
      this.db.upsertCompanyDetails(details);
      
      // Also store purely in fundamentals table for ML pipeline
      this.db.saveFundamentals({
        symbol: symbol.toUpperCase(),
        trailing_pe: details.pe_ratio, // this is forward PE right now, but fine as proxy
        forward_pe: summary?.summaryProfile?.forwardPE || quote?.forwardPE || null,
        price_to_book: details.pb_ratio,
        return_on_equity: details.roe,
        debt_to_equity: details.debt_equity
      });

      console.log(`✅ Stored company details & fundamentals for ${symbol}`);
      
      return details;
      
    } catch (error) {
      console.error(`❌ Error fetching company details for ${symbol}:`, error.stack);
      
      // Return basic info from database if available
      const existing = this.db.getCompanyDetails(symbol);
      if (existing) return existing;
      
      return {
        symbol: symbol.toUpperCase(),
        name: symbol,
        sector: SECTOR_MAP[symbol.toUpperCase()]?.sector || 'Unknown',
        industry: SECTOR_MAP[symbol.toUpperCase()]?.industry || 'Unknown',
        about: 'Company details fetching failed. Please try again later.',
        error: error.message
      };
    }
  }

  /**
   * Get company details from local database or fetch
   */
  async getCompanyDetails(symbol) {
    // Check database first
    let details = this.db.getCompanyDetails(symbol);
    
    // If not in database or outdated (older than 1 day), fetch fresh
    if (!details || this.isDataStale(details.updated_at)) {
      details = await this.fetchAndStoreCompanyDetails(symbol);
    }
    
    return details;
  }

  /**
   * Check if data is stale (older than 24 hours)
   */
  isDataStale(updatedAt) {
    if (!updatedAt) return true;
    const updated = new Date(updatedAt);
    const hoursSinceUpdate = (Date.now() - updated.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  }

  /**
   * Batch fetch company details
   */
  async batchFetchCompanyDetails(symbols) {
    const results = [];
    
    for (const symbol of symbols) {
      try {
        const details = await this.fetchAndStoreCompanyDetails(symbol);
        results.push(details);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({ symbol, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Search companies by name or symbol
   */
  searchCompanies(query) {
    return this.db.searchStocks(query);
  }
}

module.exports = CompanyDetailsService;
