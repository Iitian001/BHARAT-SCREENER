/**
 * Angel One API Integration
 * Connect to Angel One (formerly Angel Broking) SmartAPI
 * Includes TOTP-based login (otplib) for future use.
 */

const axios = require('axios');

// TOTP support — optional, only loaded if otplib is installed.
let totp = null;
try {
  const otplib = require('otplib');
  totp = otplib.totp;
} catch (_) {
  // otplib not installed yet; TOTP unavailable but non-fatal
}

class AngelOneProvider {
  constructor() {
    this.baseURL = 'https://apiconnect.angelbroking.com';
    this.apiKey = process.env.ANGEL_ONE_API_KEY || '';
    this.accessToken = null;
    this.refreshToken = null;
    this.clientCode = process.env.ANGEL_ONE_CLIENT_CODE || '';
    this.password = process.env.ANGEL_ONE_PASSWORD || '';
    this.totpKey = process.env.ANGEL_ONE_TOTP_KEY || '';

    this.httpClient = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB'
      }
    });
  }

  /**
   * Check if Angel One is fully configured (API key + client code + password + TOTP key).
   */
  isConfigured() {
    return !!(this.apiKey && this.clientCode && this.password && this.totpKey);
  }

  /**
   * Generate a TOTP code from the stored key.
   * Returns null if otplib is not installed or no TOTP key is set.
   */
  generateTOTP() {
    if (!totp || !this.totpKey) return null;
    return totp.generate(this.totpKey);
  }

  /**
   * Generate session and get access token.
   * Includes TOTP in the auth payload when available.
   */
  async generateSession() {
    if (!this.apiKey || !this.clientCode || !this.password) {
      throw new Error(
        'Angel One API not configured. Set ANGEL_ONE_API_KEY, ANGEL_ONE_CLIENT_CODE, and ANGEL_ONE_PASSWORD in .env'
      );
    }

    const payload = {
      clientcode: this.clientCode,
      password: this.password
    };

    // Include TOTP if available
    const totpCode = this.generateTOTP();
    if (totpCode) {
      payload.totp = totpCode;
    }

    const response = await this.httpClient.post(
      '/rest/auth/angelbroking/jwt/v1.0/generate_tokens',
      payload,
      { headers: { 'X-PrivateKey': this.apiKey } }
    );

    if (response.data.status && response.data.data) {
      this.accessToken = response.data.data.jwtToken;
      this.refreshToken = response.data.data.refreshToken;
      this.httpClient.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
      return { success: true, token: this.accessToken };
    }

    throw new Error(response.data.message || 'Failed to generate session');
  }

  /**
   * Get stock quote / LTP
   */
  async getQuote(symbol, exchange = 'NSE') {
    try {
      if (!this.accessToken) await this.generateSession();

      const response = await this.httpClient.post('/rest/secure/angelbroking/order/v1/getLTP', {
        tradingsymbol: symbol,
        symboltoken: await this.getSymbolToken(symbol, exchange),
        exchange
      });

      if (response.data.status && response.data.data) {
        const data = response.data.data;
        return {
          symbol,
          price: parseFloat(data.ltp),
          open: parseFloat(data.open) || parseFloat(data.ltp),
          high: parseFloat(data.high) || parseFloat(data.ltp),
          low: parseFloat(data.low) || parseFloat(data.ltp),
          previousClose: parseFloat(data.close) || parseFloat(data.ltp),
          change: parseFloat(data.ltp) - parseFloat(data.close),
          changePercent: ((parseFloat(data.ltp) - parseFloat(data.close)) / parseFloat(data.close)) * 100,
          volume: parseInt(data.volume) || 0,
          exchange,
          isRealData: true,
          source: 'Angel One'
        };
      }

      throw new Error(response.data.message || 'Failed to get quote');
    } catch (error) {
      console.error('Angel One getQuote error:', error.message);
      throw error;
    }
  }

  /**
   * Get symbol token (required by Angel One API)
   */
  symbolTokenCache = new Map();

  async getSymbolToken(symbol, exchange = 'NSE') {
    const cacheKey = `${exchange}:${symbol}`;
    if (this.symbolTokenCache.has(cacheKey)) return this.symbolTokenCache.get(cacheKey);

    try {
      if (!this.accessToken) await this.generateSession();

      const response = await this.httpClient.post('/rest/secure/angelbroking/market/v1/getSymbolTicker', {
        symbol,
        exchange
      });

      if (response.data.status && response.data.data?.symboltoken) {
        this.symbolTokenCache.set(cacheKey, response.data.data.symboltoken);
        return response.data.data.symboltoken;
      }

      return this.getFallbackToken(symbol, exchange);
    } catch (error) {
      console.warn('Angel One symbol token fetch failed, using fallback:', error.message);
      return this.getFallbackToken(symbol, exchange);
    }
  }

  /**
   * Fallback token mapping for common NSE stocks
   */
  getFallbackToken(symbol) {
    const tokenMap = {
      'RELIANCE': '2885',
      'TCS': '11536',
      'INFY': '1594',
      'HDFC': '1333',
      'ICICIBANK': '4963',
      'HINDUNILVR': '317',
      'KOTAKBANK': '4923',
      'BHARTIARTL': '10604',
      'ITC': '1660',
      'SBIN': '3045',
      'BAJFINANCE': '3171',
      'LT': '11483',
      'HCLTECH': '459',
      'AXISBANK': '5900',
      'WIPRO': '3787',
      'NIFTY': '26000',
      'BANKNIFTY': '26009'
    };
    return tokenMap[symbol.toUpperCase()] || '0';
  }

  /**
   * Get market status
   */
  async getMarketStatus() {
    try {
      if (!this.accessToken) await this.generateSession();

      const response = await this.httpClient.get('/rest/secure/angelbroking/market/v1/marketStatus');

      if (response.data.status && response.data.data) {
        return {
          exchange: 'NSE',
          status: response.data.data.marketStatus,
          lastUpdated: new Date().toISOString(),
          isRealData: true
        };
      }

      throw new Error('Failed to get market status');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get historical data
   */
  async getHistoricalData(symbol, interval = 'ONE_DAY', fromdate, todate, exchange = 'NSE') {
    try {
      if (!this.accessToken) await this.generateSession();

      const response = await this.httpClient.post('/rest/secure/angelbroking/historical/v1/getCandleData', {
        exchange,
        symboltoken: await this.getSymbolToken(symbol, exchange),
        interval,
        fromdate,
        todate
      });

      if (response.data.status && response.data.data) {
        return response.data.data.map(candle => ({
          timestamp: new Date(candle[0]),
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));
      }

      throw new Error('Failed to get historical data');
    } catch (error) {
      throw error;
    }
  }
}

// Singleton
const angelOneProvider = new AngelOneProvider();

module.exports = {
  AngelOneProvider,
  angelOneProvider
};
