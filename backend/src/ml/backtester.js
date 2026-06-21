const TechnicalIndicators = require('./technicalIndicators');
const mlModelInstance = require('./mlModel');
const HistoricalDataService = require('../services/historicalDataService');

/**
 * Walk-Forward Backtesting Engine
 * Simulates trading a strategy over historical data, accounting for realistic Indian market transaction costs.
 */
class Backtester {
  constructor() {
    this.histService = new HistoricalDataService();
    this.mlModel = mlModelInstance;
    
    // Indian Market Transaction Costs (Approximate for Equity Delivery)
    this.costs = {
      brokerage: 0.0003, // 0.03%
      stt: 0.001,        // 0.1% Securities Transaction Tax
      exchangeTxn: 0.0000345, // NSE txn charge
      gst: 0.18,         // 18% on brokerage + txn charges
      sebi: 0.000001,    // 0.0001%
      stampDuty: 0.00015, // 0.015% (Buy side only)
      slippage: 0.0005   // 0.05% assumed slippage per trade
    };
  }

  calculateCosts(tradeValue, isBuy) {
    const brokerageAmt = tradeValue * this.costs.brokerage;
    const sttAmt = tradeValue * this.costs.stt;
    const txnAmt = tradeValue * this.costs.exchangeTxn;
    const gstAmt = (brokerageAmt + txnAmt) * this.costs.gst;
    const sebiAmt = tradeValue * this.costs.sebi;
    const stampAmt = isBuy ? tradeValue * this.costs.stampDuty : 0;
    const slippageAmt = tradeValue * this.costs.slippage;
    
    return brokerageAmt + sttAmt + txnAmt + gstAmt + sebiAmt + stampAmt + slippageAmt;
  }

  async runWalkForwardBacktest(symbol, initialCapital = 100000) {
    console.log(`\nStarting Walk-Forward Backtest for ${symbol}...`);
    const data = this.histService.getStoredHistoricalData(symbol, 1);
    
    if (!data || data.length < 200) {
      console.log(`Insufficient data for ${symbol}. Need at least 200 days.`);
      return null;
    }

    let capital = initialCapital;
    let position = 0; // Number of shares
    let entryPrice = 0;
    const trades = [];
    
    // Start testing from day 100 to allow sufficient history for initial training
    const startIdx = 100;
    
    // Track daily equity for Sharpe Ratio
    let dailyEquity = [];
    const riskFreeRate = 0.06; // 6% Indian Risk Free Rate

    // Retrain the model every 30 days to simulate walk-forward walk
    for (let i = startIdx; i < data.length - 1; i++) {
      const currentDay = data[i];
      const nextDay = data[i + 1];
      const historicalSlice = data.slice(0, i + 1); // Data up to today
      
      // Retrain model periodically (every 30 trading days)
      if (i === startIdx || i % 30 === 0) {
        // console.log(`[Walk-Forward] Retraining model up to ${new Date(currentDay.timestamp).toLocaleDateString()}...`);
        await this.mlModel.trainModelForSymbol(symbol, historicalSlice);
      }

      // Get Prediction using ONLY data available up to today
      const prediction = await this.mlModel.predictAsync({
        symbol,
        historicalData: historicalSlice,
        currentData: currentDay
      });

      const currentPrice = currentDay.close;

      // Calculate daily equity (Cash + Value of open position at current day's close)
      const currentEquity = capital + (position * currentPrice);
      dailyEquity.push({ date: currentDay.timestamp, equity: currentEquity });

      // Simple execution logic based on ML prediction signal
      if (prediction.action === 'BUY' && position === 0) {
        // Position sizing: risk 1% of capital based on ATR
        const atr = prediction.indicators.atr || (currentPrice * 0.02); // fallback 2% ATR
        const riskPerShare = atr;
        const totalRisk = capital * 0.01; // 1% risk
        const targetQuantity = Math.floor(totalRisk / riskPerShare);
        
        // Ensure we don't exceed available capital
        const maxQuantity = Math.floor(capital / currentPrice);
        const actualQuantity = Math.min(targetQuantity, maxQuantity);

        if (actualQuantity > 0) {
          const tradeValue = actualQuantity * currentPrice;
          const costs = this.calculateCosts(tradeValue, true);
          
          if (capital >= tradeValue + costs) {
            position = actualQuantity;
            capital -= (tradeValue + costs);
            entryPrice = currentPrice;
            trades.push({ type: 'BUY', date: currentDay.timestamp, price: currentPrice, qty: position, costs, value: tradeValue });
          }
        }
      } else if (prediction.action === 'SELL' && position > 0) {
        const tradeValue = position * currentPrice;
        const costs = this.calculateCosts(tradeValue, false);
        
        capital += (tradeValue - costs);
        trades.push({ type: 'SELL', date: currentDay.timestamp, price: currentPrice, qty: position, costs, value: tradeValue, pnl: (currentPrice - entryPrice) * position - costs });
        position = 0;
        entryPrice = 0;
      }
    }

    // Force close any open position at the end of the test
    if (position > 0) {
      const finalPrice = data[data.length - 1].close;
      const tradeValue = position * finalPrice;
      const costs = this.calculateCosts(tradeValue, false);
      capital += (tradeValue - costs);
      trades.push({ type: 'SELL (FORCE CLOSE)', date: data[data.length - 1].timestamp, price: finalPrice, qty: position, costs, value: tradeValue, pnl: (finalPrice - entryPrice) * position - costs });
      position = 0;
    }

    // Include the final day in equity curve
    dailyEquity.push({ date: data[data.length - 1].timestamp, equity: capital });

    // Calculate Metrics
    const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const totalCompletedTrades = trades.filter(t => t.type.includes('SELL')).length;
    const winRate = totalCompletedTrades > 0 ? (winningTrades / totalCompletedTrades) * 100 : 0;
    
    // Calculate Max Drawdown and Sharpe Ratio
    let peakCapital = initialCapital;
    let maxDrawdown = 0;
    let dailyReturns = [];

    for (let i = 1; i < dailyEquity.length; i++) {
      const prev = dailyEquity[i - 1].equity;
      const curr = dailyEquity[i].equity;
      if (curr > peakCapital) peakCapital = curr;
      const drawdown = ((peakCapital - curr) / peakCapital) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      
      const dailyRet = (curr - prev) / prev;
      dailyReturns.push(dailyRet);
    }

    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDevDailyReturn = Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgDailyReturn, 2), 0) / dailyReturns.length);
    const annualizedReturn = avgDailyReturn * 252; // 252 trading days
    const annualizedStdDev = stdDevDailyReturn * Math.sqrt(252);
    
    // Sharpe Ratio = (Expected Return - Risk Free Rate) / Portfolio Standard Deviation
    const sharpeRatio = annualizedStdDev > 0 ? (annualizedReturn - riskFreeRate) / annualizedStdDev : 0;

    // Benchmark Return (Buy & Hold Underlying Stock)
    const startPrice = data[startIdx].close;
    const endPrice = data[data.length - 1].close;
    const benchmarkReturn = ((endPrice - startPrice) / startPrice) * 100;

    const report = {
      symbol,
      initialCapital,
      finalCapital: capital,
      totalReturnPct: totalReturn.toFixed(2),
      benchmarkReturnPct: benchmarkReturn.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      maxDrawdownPct: maxDrawdown.toFixed(2),
      winRatePct: winRate.toFixed(2),
      totalTrades: totalCompletedTrades,
      totalCostsPaid: trades.reduce((acc, t) => acc + t.costs, 0).toFixed(2)
    };

    console.log('\n--- BACKTEST RESULTS ---');
    console.table([report]);
    return report;
  }
}

// Allow running directly from CLI: node backend/src/ml/backtester.js RELIANCE
if (require.main === module) {
  const arg = process.argv[2] || 'RELIANCE';
  const engine = new Backtester();
  const { getDatabase } = require('../services/database');
  
  // Ensure DB connection is established if needed, then run
  getDatabase();

  if (arg === 'batch') {
    const symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK']; // Sample batch
    console.log(`Running batch backtest on ${symbols.length} symbols...`);
    
    (async () => {
      const results = [];
      for (const sym of symbols) {
        const res = await engine.runWalkForwardBacktest(sym);
        if (res) results.push(res);
      }
      console.log('\n=== FINAL BATCH RESULTS ===');
      console.table(results);
      process.exit(0);
    })();
  } else {
    engine.runWalkForwardBacktest(arg).then(() => {
      process.exit(0);
    });
  }
}

module.exports = Backtester;
