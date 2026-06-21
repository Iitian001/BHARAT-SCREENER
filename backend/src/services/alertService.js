const TechnicalIndicators = require('../ml/technicalIndicators');

class AlertService {
  constructor(historicalDataService, clients) {
    this.histService = historicalDataService;
    this.clients = clients; // WebSocket clients Set
    this.lastAlertTime = new Map(); // Prevent spamming alerts for same symbol
  }

  /**
   * Monitor a batch of updated stocks for breakout setups
   */
  async processBatch(updatedStocks) {
    const alerts = [];

    for (const stock of updatedStocks) {
      // Skip if we already alerted in the last 15 minutes
      const lastAlert = this.lastAlertTime.get(stock.symbol);
      if (lastAlert && (Date.now() - lastAlert) < 15 * 60 * 1000) {
        continue;
      }

      // We need historical data to detect a true breakout
      const historicalData = this.histService.getStoredHistoricalData(stock.symbol, 1);
      if (!historicalData || historicalData.length < 50) continue;

      // Append current live data to historical for real-time analysis
      const liveData = [...historicalData];
      liveData.push({
        high: stock.high,
        low: stock.low,
        close: stock.price,
        volume: stock.volume
      });

      const indicators = TechnicalIndicators.calculateAll(liveData);
      if (!indicators) continue;

      // BREAKOUT LOGIC
      // 1. Price crosses above Upper Bollinger Band
      // 2. Volume is > 300% of 20-day SMA Volume
      // 3. MACD Bullish Crossover
      
      let isBreakout = false;
      let reason = '';

      if (indicators.bollingerBands && indicators.volumeSMA20) {
        const priceAboveBB = stock.price > indicators.bollingerBands.upper;
        const massiveVolume = stock.volume > (indicators.volumeSMA20 * 3);
        
        if (priceAboveBB && massiveVolume) {
          isBreakout = true;
          reason = 'Massive Volume Breakout + Price above Upper Bollinger Band';
        }
      }

      if (!isBreakout && indicators.macd && indicators.macd.histogram > 0) {
        // Check if MACD just crossed over
        const prevData = historicalData.slice(-15);
        const prevIndicators = TechnicalIndicators.calculateAll(prevData);
        if (prevIndicators && prevIndicators.macd && prevIndicators.macd.histogram <= 0) {
          // Fresh crossover
          if (stock.volume > (indicators.volumeSMA20 * 1.5)) {
            isBreakout = true;
            reason = 'Fresh MACD Bullish Crossover on High Volume';
          }
        }
      }

      if (isBreakout) {
        this.lastAlertTime.set(stock.symbol, Date.now());
        alerts.push({
          symbol: stock.symbol,
          name: stock.name,
          price: stock.price,
          reason: reason,
          timestamp: Date.now()
        });
      }
    }

    if (alerts.length > 0) {
      this.broadcastAlerts(alerts);
    }
  }

  broadcastAlerts(alerts) {
    if (this.clients.size === 0) return;

    const message = JSON.stringify({
      type: 'trade_alerts',
      data: alerts,
      timestamp: new Date().toISOString()
    });

    this.clients.forEach(client => {
      // assuming WebSocket.OPEN is 1
      if (client.readyState === 1) {
        client.send(message);
      }
    });
    
    console.log(`[AlertService] Broadcasted ${alerts.length} breakout alerts!`);
  }
}

module.exports = AlertService;
