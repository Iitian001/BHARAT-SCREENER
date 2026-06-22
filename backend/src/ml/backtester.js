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
    
    // Indian Market Transaction Costs
    this.costs = {
      delivery: {
        brokerage: 0.0003, // 0.03% or Rs 20 (whichever is lower, using simplified % here)
        stt: 0.001,        // 0.1% on buy and sell
        exchangeTxn: 0.0000345,
        gst: 0.18,
        sebi: 0.000001,
        stampDuty: 0.00015, // Buy only
        slippage: 0.0005
      },
      intraday: {
        brokerage: 0.0003, // Max Rs 20, but simplified
        stt: 0.00025,      // 0.025% on sell side ONLY
        exchangeTxn: 0.0000345,
        gst: 0.18,
        sebi: 0.000001,
        stampDuty: 0.00003, // 0.003% Buy only
        slippage: 0.0005
      }
    };
  }

  calculateCosts(tradeValue, isBuy, mode = 'delivery') {
    const profile = this.costs[mode] || this.costs.delivery;
    
    // Brokerage is max Rs 20
    const calculatedBrokerage = tradeValue * profile.brokerage;
    const brokerageAmt = Math.min(calculatedBrokerage, 20);
    
    // STT is 0 on buy for intraday
    let sttAmt = 0;
    if (mode === 'delivery') {
      sttAmt = tradeValue * profile.stt;
    } else if (mode === 'intraday' && !isBuy) {
      sttAmt = tradeValue * profile.stt;
    }

    const txnAmt = tradeValue * profile.exchangeTxn;
    const gstAmt = (brokerageAmt + txnAmt) * profile.gst;
    const sebiAmt = tradeValue * profile.sebi;
    const stampAmt = isBuy ? tradeValue * profile.stampDuty : 0;
    const slippageAmt = tradeValue * profile.slippage;
    
    return brokerageAmt + sttAmt + txnAmt + gstAmt + sebiAmt + stampAmt + slippageAmt;
  }

  async runWalkForwardBacktest(symbol, initialCapital = 100000, mode = 'delivery', modelType = 'ensemble', params = { conf: 65, returnThresh: 1.5 }, timeWindow = 'all', holdoutDate = null) {
    console.log(`\nStarting Walk-Forward Backtest for ${symbol} (Mode: ${mode}, Model: ${modelType}, TimeWindow: ${timeWindow})...`);
    let data = this.histService.getStoredHistoricalData(symbol, 1);
    
    if (!data || data.length < 200) {
      console.log(`Insufficient data for ${symbol}. Need at least 200 days.`);
      return null;
    }

    // Apply time-based holdout filter if specified
    if (holdoutDate) {
      if (timeWindow === 'tuning') {
        data = data.filter(d => new Date(d.timestamp) < new Date(holdoutDate));
      } else if (timeWindow === 'holdout') {
        data = data.filter(d => new Date(d.timestamp) >= new Date(holdoutDate));
      }
    }

    if (data.length < 50) {
      console.log(`Insufficient data for ${symbol} in window ${timeWindow}.`);
      return null;
    }

    // Bulk fetch XGBoost predictions if we are using xgboost or ensemble
    let xgbHistorical = {};
    if (modelType === 'xgboost' || modelType === 'ensemble') {
      try {
        const axios = require('axios');
        const res = await axios.get(`http://localhost:8000/historical_predict/${symbol}`);
        xgbHistorical = res.data;
      } catch (err) {
        console.error(`Failed to fetch historical XGBoost data for ${symbol}. Is the python service running?`);
        return null;
      }
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

    // Retrain the model every 30 days to simulate walk-forward walk (only needed for TFJS LSTM)
    for (let i = startIdx; i < data.length - 1; i++) {
      const currentDay = data[i];
      const nextDay = data[i + 1];
      const historicalSlice = data.slice(0, i + 1); // Data up to today
      const dateStr = currentDay.timestamp;
      
      let prediction = { action: 'HOLD', indicators: {} };

      if (modelType === 'xgboost') {
        const xgbPred = xgbHistorical[dateStr];
        prediction.action = xgbPred ? xgbPred.action : 'HOLD';
        // Mock ATR for position sizing
        const indicators = TechnicalIndicators.calculateAll(historicalSlice);
        prediction.indicators = { atr: indicators.atr14 };
        
        // Apply custom sweep thresholds if needed (XGBoost already uses 0.65 internally, but we can override if we passed raw prob. 
        // For now XGB returns action based on 0.65).
      } else {
        // Retrain model periodically (every 30 trading days)
        if (i === startIdx || i % 30 === 0) {
          await this.mlModel.trainModelForSymbol(symbol, historicalSlice);
        }

        // Get Prediction using ONLY data available up to today
        prediction = await this.mlModel.predictAsync({
          symbol,
          historicalData: historicalSlice,
          currentData: currentDay,
          modelType,
          params,
          xgbAction: xgbHistorical[dateStr] ? xgbHistorical[dateStr].action : null
        });
      }

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
          const costs = this.calculateCosts(tradeValue, true, mode);
          
          if (capital >= tradeValue + costs) {
            position = actualQuantity;
            capital -= (tradeValue + costs);
            entryPrice = currentPrice;
            trades.push({ type: 'BUY', date: currentDay.timestamp, price: currentPrice, qty: position, costs, value: tradeValue });
          }
        }
      } else if (prediction.action === 'SELL' && position > 0) {
        const tradeValue = position * currentPrice;
        const costs = this.calculateCosts(tradeValue, false, mode);
        
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
      const costs = this.calculateCosts(tradeValue, false, mode);
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

// Allow running directly from CLI: node backend/src/ml/backtester.js batch --mode intraday --model ensemble
if (require.main === module) {
  const args = process.argv.slice(2);
  const symbolArg = args.find(a => !a.startsWith('--')) || 'RELIANCE';
  
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx !== -1 && args[modeIdx + 1] ? args[modeIdx + 1] : 'delivery';
  
  const modelIdx = args.indexOf('--model');
  const modelType = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : 'ensemble';

  const isSweep = args.includes('--sweep');

  const engine = new Backtester();
  const dbService = require('../services/database');
  const dbInstance = dbService.getDatabase(); // Initialize DB connection

  (async () => {
    if (symbolArg === 'batch') {
      // Get top 50 highly liquid stocks across sectors from SQLite that have enough data
      const stmt = dbInstance.db.prepare(`
        SELECT symbol FROM price_history 
        GROUP BY symbol 
        HAVING count(timestamp) >= 200 
        LIMIT 50
      `);
      const rows = stmt.all();
      const symbols = rows.map(r => r.symbol);
      
      if (symbols.length === 0) {
        console.log("No symbols with 200+ days of history found.");
        process.exit(1);
      }

      // Calculate temporal holdout date (6 months ago from latest overall)
      const latestTimestamp = dbInstance.db.prepare('SELECT MAX(timestamp) as max_ts FROM price_history').get().max_ts;
      const latestDate = new Date(latestTimestamp);
      latestDate.setMonth(latestDate.getMonth() - 6);
      const holdoutDate = latestDate.toISOString();

      // Split symbols: 70% tuning, 30% holdout
      // Use deterministic shuffle for reproducibility
      const shuffled = [...symbols].sort((a, b) => a.localeCompare(b));
      const splitIdx = Math.floor(shuffled.length * 0.7);
      const tuningSymbols = shuffled.slice(0, splitIdx);
      const holdoutSymbols = shuffled.slice(splitIdx);

      console.log(`\n* WARNING: Universe excludes delisted stocks; results are survivorship-biased *\n`);

      if (isSweep) {
        console.log(`Running Grid Search on ${tuningSymbols.length} tuning symbols. Time holdout active...`);
        
        const paramGrid = [];
        for (const conf of [55, 60, 65, 70, 75]) {
          for (const returnThresh of [1.0, 1.5, 2.0]) {
            paramGrid.push({ conf, returnThresh });
          }
        }

        const gridResults = [];

        for (const params of paramGrid) {
          console.log(`\n=== Tuning Params: Confidence > ${params.conf}, Return > ${params.returnThresh}% ===`);
          const results = [];
          
          for (const sym of tuningSymbols) {
            const res = await engine.runWalkForwardBacktest(sym, 100000, mode, modelType, params, 'tuning', holdoutDate);
            if (res) {
              results.push(res);
              dbInstance.saveBacktestRun({
                symbol: res.symbol,
                mode, model_type: modelType, initial_capital: res.initialCapital, final_capital: res.finalCapital,
                total_return_pct: parseFloat(res.totalReturnPct), benchmark_return_pct: parseFloat(res.benchmarkReturnPct),
                sharpe_ratio: parseFloat(res.sharpeRatio), max_drawdown_pct: parseFloat(res.maxDrawdownPct),
                win_rate_pct: parseFloat(res.winRatePct), total_trades: res.totalTrades, hyperparameters: JSON.stringify(params),
                holdout_type: 'tuning', is_survivorship_biased: 1
              });
            }
          }
          
          if (results.length > 0) {
            const avgSharpe = results.reduce((acc, r) => acc + parseFloat(r.sharpeRatio), 0) / results.length;
            const avgReturn = results.reduce((acc, r) => acc + parseFloat(r.totalReturnPct), 0) / results.length;
            gridResults.push({
              conf: params.conf, returnThresh: params.returnThresh,
              avgSharpe: parseFloat(avgSharpe.toFixed(2)), avgReturn: parseFloat(avgReturn.toFixed(2)),
              totalTrades: results.reduce((acc, r) => acc + r.totalTrades, 0)
            });
          }
        }

        console.log('\n=== TUNING RESULTS ===');
        gridResults.sort((a, b) => b.avgSharpe - a.avgSharpe); 
        console.table(gridResults);

        const bestParams = gridResults[0];
        console.log(`\n🏆 Best Parameters: Confidence ${bestParams.conf}, Return Thresh ${bestParams.returnThresh}%`);
        console.log(`\nEvaluating Best Parameters on HOLDOUT Set (${holdoutSymbols.length} stocks, last 6 months)...`);

        const holdoutResults = [];
        for (const sym of holdoutSymbols) {
          const res = await engine.runWalkForwardBacktest(sym, 100000, mode, modelType, bestParams, 'holdout', holdoutDate);
          if (res) {
            holdoutResults.push(res);
            dbInstance.saveBacktestRun({
              symbol: res.symbol,
              mode, model_type: modelType, initial_capital: res.initialCapital, final_capital: res.finalCapital,
              total_return_pct: parseFloat(res.totalReturnPct), benchmark_return_pct: parseFloat(res.benchmarkReturnPct),
              sharpe_ratio: parseFloat(res.sharpeRatio), max_drawdown_pct: parseFloat(res.maxDrawdownPct),
              win_rate_pct: parseFloat(res.winRatePct), total_trades: res.totalTrades, hyperparameters: JSON.stringify(bestParams),
              holdout_type: 'holdout', is_survivorship_biased: 1
            });
          }
        }

        const holdoutSharpe = holdoutResults.length > 0 ? (holdoutResults.reduce((acc, r) => acc + parseFloat(r.sharpeRatio), 0) / holdoutResults.length) : 0;
        
        console.log(`\n=== OVERFITTING CHECK ===`);
        console.log(`Tuning Sharpe: ${bestParams.avgSharpe.toFixed(2)} | Holdout Sharpe: ${holdoutSharpe.toFixed(2)}`);
        
        if (bestParams.avgSharpe > 0 && holdoutSharpe < bestParams.avgSharpe) {
          const dropPct = ((bestParams.avgSharpe - holdoutSharpe) / bestParams.avgSharpe) * 100;
          console.log(`Performance Drop: ${dropPct.toFixed(2)}%`);
          if (dropPct > 35) {
            console.log(`🚨 OVERFIT DETECTED! Holdout Sharpe dropped > 35%. Do not deploy these parameters.`);
          } else {
            console.log(`✅ Parameters validated. Performance drop is within acceptable variance.`);
          }
        } else {
          console.log(`✅ Parameters validated. Holdout performed well.`);
        }

      } else {
        console.log(`Running batch backtest on ${symbols.length} symbols in ${mode} mode using ${modelType} model...`);
        console.log(`\n* WARNING: Universe excludes delisted stocks; results are survivorship-biased *\n`);
        const params = { conf: 65, returnThresh: 1.5 };
        for (const sym of symbols) {
          const res = await engine.runWalkForwardBacktest(sym, 100000, mode, modelType, params);
          if (res) {
            dbInstance.saveBacktestRun({
                symbol: res.symbol, mode, model_type: modelType, initial_capital: res.initialCapital, final_capital: res.finalCapital,
                total_return_pct: parseFloat(res.totalReturnPct), benchmark_return_pct: parseFloat(res.benchmarkReturnPct),
                sharpe_ratio: parseFloat(res.sharpeRatio), max_drawdown_pct: parseFloat(res.maxDrawdownPct),
                win_rate_pct: parseFloat(res.winRatePct), total_trades: res.totalTrades, hyperparameters: JSON.stringify(params),
                holdout_type: 'none', is_survivorship_biased: 1
            });
          }
        }
      }

      process.exit(0);
    } else {
      console.log(`\n* WARNING: Universe excludes delisted stocks; results are survivorship-biased *\n`);
      const res = await engine.runWalkForwardBacktest(symbolArg, 100000, mode, modelType, { conf: 65, returnThresh: 1.5 });
      if (res) {
        dbInstance.saveBacktestRun({
            symbol: res.symbol,
            mode,
            model_type: modelType,
            initial_capital: res.initialCapital,
            final_capital: res.finalCapital,
            total_return_pct: parseFloat(res.totalReturnPct),
            benchmark_return_pct: parseFloat(res.benchmarkReturnPct),
            sharpe_ratio: parseFloat(res.sharpeRatio),
            max_drawdown_pct: parseFloat(res.maxDrawdownPct),
            win_rate_pct: parseFloat(res.winRatePct),
            total_trades: res.totalTrades,
            hyperparameters: JSON.stringify({ conf: 65, returnThresh: 1.5 }),
            holdout_type: 'none', is_survivorship_biased: 1
        });
      }
      process.exit(0);
    }
  })();
}

module.exports = Backtester;
