/**
 * Script Master Service
 * Downloads and caches all NSE/BSE listed companies
 * Source: Angel One Scrip Master or NSE India
 */

const axios = require('axios')
const fs = require('fs')
const path = require('path')

class ScripMaster {
  constructor() {
    this.scrips = []
    this.scripsBySymbol = new Map()
    this.scripsByToken = new Map()
    this.scripsByName = new Map()
    this.lastUpdated = null
    
    // Cache file path
    this.cacheDir = path.join(__dirname, '../../data')
    this.cacheFile = path.join(this.cacheDir, 'nse_scrips.json')
  }

  /**
   * Load scrips from cache or download fresh
   */
  async initialize() {
    // Create data directory if not exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
    }

    // Try loading from cache first
    if (fs.existsSync(this.cacheFile)) {
      const stats = fs.statSync(this.cacheFile)
      const ageMs = Date.now() - stats.mtimeMs
      const maxAgeMs = 24 * 60 * 60 * 1000 // 24 hours
      
      if (ageMs < maxAgeMs) {
        console.log('📁 Loading scrips from cache...')
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'))
        this.loadScrips(data.scrips)
        this.lastUpdated = data.lastUpdated
        console.log(`✅ Loaded ${this.scrips.length} scrips from cache`)
        return this.scrips.length
      }
    }

    // Download fresh data
    return await this.downloadFresh()
  }

  /**
   * Download fresh scrip master data
   */
  async downloadFresh() {
    console.log('⬇️ Downloading scrip master from Angel One...')
    
    try {
      // Angel One provides a publicly accessible scrip master file
      // Format: https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json
      const response = await axios.get(
        'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json',
        { timeout: 30000 }
      )

      const allScrips = response.data || []
      
      // Filter NSE scrips — keep equities, reject derivatives
      const nseScrips = allScrips.filter(scrip => {
        // Must be NSE exchange
        if (scrip.exch_seg !== 'NSE') return false
        // Skip if no symbol
        if (!scrip.symbol) return false
        // Keep only standard equity symbols (no options, no futures indicators)
        const sym = scrip.symbol
        if (sym.includes('-CE') || sym.includes('-PE') || sym.includes('FUT')) return false
        // Accept common instrument types for equities
        const iType = (scrip.instrumenttype || '').toUpperCase()
        if (iType && iType !== '' && iType !== 'EQ' && iType !== 'AM' && iType !== 'BE') return false
        return true
      })

      // Map to our format
      const mappedScrips = nseScrips.map(scrip => {
        // Angel One appends -EQ, -BE etc. to symbols — strip for clean display
        let cleanSymbol = scrip.symbol
        if (cleanSymbol.endsWith('-EQ') || cleanSymbol.endsWith('-BE') || cleanSymbol.endsWith('-BL')) {
          cleanSymbol = cleanSymbol.replace(/-(EQ|BE|BL)$/, '')
        }
        return {
          token: scrip.token,
          symbol: cleanSymbol,
          originalSymbol: scrip.symbol,
          name: scrip.name || cleanSymbol,
          exchange: 'NSE',
          segment: 'CM',
          lotSize: scrip.lotsize || 1,
          instrumentType: scrip.instrumenttype,
          tickSize: scrip.ticksize || 0.05,
          isin: scrip.isin || null,
          active: true,
          nameLower: (scrip.name || cleanSymbol).toLowerCase()
        }
      })

      this.loadScrips(mappedScrips)
      this.lastUpdated = new Date().toISOString()

      // Save to cache
      this.saveCache()

      console.log(`✅ Downloaded ${this.scrips.length} NSE equity scrips`)
      return this.scrips.length

    } catch (error) {
      console.error('❌ Failed to download scrip master:', error.message)
      
      // Fallback: Use predefined stocks
      return this.loadFallback()
    }
  }

  /**
   * Fallback to predefined popular stocks
   */
  loadFallback() {
    console.log('📦 Loading fallback stock list...')
    
    const fallbackStocks = [
      { token: '26009', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', sector: 'Energy' },
      { token: '1594', symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', sector: 'IT' },
      { token: '11536', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', sector: 'Banking' },
      { token: '2885', symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', sector: 'IT' },
      { token: '1232', symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '14366', symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', sector: 'Banking' },
      { token: '10999', symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'Banking' },
      { token: '1808', symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', sector: 'Telecom' },
      { token: '881', symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '16675', symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', exchange: 'NSE', sector: 'Banking' },
      { token: '11483', symbol: 'LT', name: 'Larsen & Toubro Ltd', exchange: 'NSE', sector: 'Infrastructure' },
      { token: '5258', symbol: 'AXISBANK', name: 'Axis Bank Ltd', exchange: 'NSE', sector: 'Banking' },
      { token: '317', symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', exchange: 'NSE', sector: 'Financial Services' },
      { token: '21808', symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '1348', symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', exchange: 'NSE', sector: 'Consumer' },
      { token: '3456', symbol: 'DMART', name: 'Avenue Supermarts Ltd', exchange: 'NSE', sector: 'Retail' },
      { token: '18538', symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '11532', symbol: 'TATASTEEL', name: 'Tata Steel Ltd', exchange: 'NSE', sector: 'Metals' },
      { token: '14775', symbol: 'WIPRO', name: 'Wipro Ltd', exchange: 'NSE', sector: 'IT' },
      { token: '20374', symbol: 'HCLTECH', name: 'HCL Technologies Ltd', exchange: 'NSE', sector: 'IT' },
      { token: '14977', symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries Ltd', exchange: 'NSE', sector: 'Pharma' },
      { token: '15140', symbol: 'NTPC', name: 'NTPC Ltd', exchange: 'NSE', sector: 'Power' },
      { token: '10666', symbol: 'POWERGRID', name: 'Power Grid Corporation of India Ltd', exchange: 'NSE', sector: 'Power' },
      { token: '14472', symbol: 'TITAN', name: 'Titan Company Ltd', exchange: 'NSE', sector: 'Consumer' },
      { token: '157', symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', exchange: 'NSE', sector: 'Conglomerate' },
      { token: '2176', symbol: 'ADANIPORTS', name: 'Adani Ports and Special Economic Zone Ltd', exchange: 'NSE', sector: 'Infrastructure' },
      { token: '3176', symbol: 'DABUR', name: 'Dabur India Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '18921', symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', exchange: 'NSE', sector: 'Cement' },
      { token: '4268', symbol: 'GRASIM', name: 'Grasim Industries Ltd', exchange: 'NSE', sector: 'Cement' },
      { token: '3506', symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd", exchange: 'NSE', sector: 'Pharma' },
      { token: '878', symbol: 'JIOFIN', name: 'Jio Financial Services Ltd', exchange: 'NSE', sector: 'Financial Services' },
      { token: '10604', symbol: 'ONGC', name: 'Oil and Natural Gas Corporation Ltd', exchange: 'NSE', sector: 'Oil & Gas' },
      { token: '13938', symbol: 'BPCL', name: 'Bharat Petroleum Corporation Ltd', exchange: 'NSE', sector: 'Oil & Gas' },
      { token: '16479', symbol: 'SHREECEM', name: 'Shree Cement Ltd', exchange: 'NSE', sector: 'Cement' },
      { token: '17665', symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', exchange: 'NSE', sector: 'Metals' },
      { token: '14109', symbol: 'HINDALCO', name: 'Hindalco Industries Ltd', exchange: 'NSE', sector: 'Metals' },
      { token: '1964', symbol: 'COALINDIA', name: 'Coal India Ltd', exchange: 'NSE', sector: 'Mining' },
      { token: '11994', symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', exchange: 'NSE', sector: 'Financial Services' },
      { token: '17863', symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '18861', symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '7421', symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '10859', symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', exchange: 'NSE', sector: 'Auto' },
      { token: '10638', symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '11287', symbol: 'NESTLEIND', name: 'Nestle India Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '3484', symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', exchange: 'NSE', sector: 'FMCG' },
      { token: '1809', symbol: 'CIPLA', name: 'Cipla Ltd', exchange: 'NSE', sector: 'Pharma' },
      { token: '14942', symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise Ltd', exchange: 'NSE', sector: 'Healthcare' },
      { token: '1922', symbol: 'DIVISLAB', name: "Divi's Laboratories Ltd", exchange: 'NSE', sector: 'Pharma' },
      { token: '2664', symbol: 'INDIGO', name: 'InterGlobe Aviation Ltd', exchange: 'NSE', sector: 'Aviation' },
      { token: '6297', symbol: 'ZOMATO', name: 'Zomato Ltd', exchange: 'NSE', sector: 'Technology' }
    ]

    this.loadScrips(fallbackStocks.map(s => ({ ...s, nameLower: s.name.toLowerCase() })))
    this.lastUpdated = new Date().toISOString()
    
    console.log(`✅ Loaded ${this.scrips.length} fallback stocks`)
    return this.scrips.length
  }

  /**
   * Load scrips into memory indexes
   */
  loadScrips(scrips) {
    this.scrips = scrips
    this.scripsBySymbol.clear()
    this.scripsByToken.clear()
    this.scripsByName.clear()

    for (const scrip of scrips) {
      // Index by symbol
      this.scripsBySymbol.set(scrip.symbol.toUpperCase(), scrip)
      
      // Index by token
      this.scripsByToken.set(scrip.token, scrip)
      
      // Index by name (lowercase for searching)
      const nameKey = scrip.nameLower || (scrip.name || '').toLowerCase()
      this.scripsByName.set(nameKey, scrip)
    }
  }

  /**
   * Save to cache file
   */
  saveCache() {
    const data = {
      lastUpdated: this.lastUpdated,
      scrips: this.scrips
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2))
    console.log('💾 Scrips cached to', this.cacheFile)
  }

  /**
   * Search stocks by query (symbol or name)
   */
  search(query, limit = 20) {
    if (!query || query.length < 1) {
      return this.scrips.slice(0, limit)
    }

    const queryLower = query.toLowerCase()
    const results = []

    // Exact symbol match first
    const exactMatch = this.scripsBySymbol.get(query.toUpperCase())
    if (exactMatch) {
      results.push(exactMatch)
    }

    // Prefix matches
    for (const scrip of this.scrips) {
      if (results.length >= limit) break
      
      const symbol = scrip.symbol.toLowerCase()
      const name = scrip.nameLower || (scrip.name || '').toLowerCase()
      
      if (symbol.startsWith(queryLower) || name.includes(queryLower)) {
        if (!results.find(r => r.token === scrip.token)) {
          results.push(scrip)
        }
      }
    }

    return results
  }

  /**
   * Get scrip by symbol
   */
  getBySymbol(symbol) {
    return this.scripsBySymbol.get(symbol.toUpperCase())
  }

  /**
   * Get scrip by token
   */
  getByToken(token) {
    return this.scripsByToken.get(token)
  }

  /**
   * Get all scrips
   */
  getAll() {
    return this.scrips
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalScrips: this.scrips.length,
      lastUpdated: this.lastUpdated,
      cacheFile: this.cacheFile
    }
  }
}

// Singleton instance
const scripMaster = new ScripMaster()

module.exports = scripMaster
