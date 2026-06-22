const path = require('path');
const { getDatabase } = require('./services/database');
const TechnicalIndicators = require('./ml/technicalIndicators');
const mlModel = require('./ml/mlModel');
const HistoricalDataService = require('./services/historicalDataService');

async function runPortfolioBacktest(budget = 100000, daysToTest = 100) {
  const dbService = getDatabase();
  const _histService = new HistoricalDataService();
  
  console.log(`\n🚀 Starting Portfolio Backtest: ${daysToTest} days, ₹${budget} starting budget...`);
  
  const allCachedSymbols = _histService.getAllCachedSymbols();
  if (!allCachedSymbols || allCachedSymbols.length === 0) {
    console.error("No cached symbols found in database.");
    return;
  }
  
  let currentPortfolioValue = budget;
  let equityCurve = [];
  
  let globalLatestTimestamp = 0;
  for (const { symbol } of allCachedSymbols) {
    const hist = _histService.getStoredHistoricalData(symbol, 1);
    if (hist && hist.length > 0) {
      const ts = new Date(hist[hist.length - 1].timestamp).getTime();
      if (ts > globalLatestTimestamp) globalLatestTimestamp = ts;
    }
  }
  
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  let currentPositions = []; 
  let cash = budget;
  
  for (let offset = daysToTest; offset >= 0; offset -= 5) {
    const simulationTime = new Date(globalLatestTimestamp - (offset * DAY_IN_MS));
    console.log(`\n📅 Evaluating date: ${simulationTime.toISOString().split('T')[0]}`);
    
    for (let i = currentPositions.length - 1; i >= 0; i--) {
      const pos = currentPositions[i];
      const stockHist = _histService.getStoredHistoricalData(pos.symbol, 1);
      const exitData = stockHist.filter(h => new Date(h.timestamp).getTime() <= simulationTime.getTime()).pop();
      
      if (exitData) {
        const exitPrice = exitData.close;
        const pnl = (exitPrice - pos.buyPrice) * pos.quantity;
        cash += (exitPrice * pos.quantity);
        console.log(`   🔴 SOLD ${pos.symbol} at ₹${exitPrice.toFixed(2)} (Bought at ₹${pos.buyPrice.toFixed(2)}) | P&L: ₹${pnl.toFixed(2)}`);
      }
      currentPositions.splice(i, 1);
    }
    
    currentPortfolioValue = cash;
    
    const analyzedStocks = [];
    
    for (const { symbol } of allCachedSymbols) {
      const fullHist = _histService.getStoredHistoricalData(symbol, 1);
      if (!fullHist || fullHist.length < 50) continue;
      
      const cutoffHist = fullHist.filter(h => new Date(h.timestamp).getTime() <= simulationTime.getTime());
      if (cutoffHist.length < 50) continue;
      
      const currentData = { price: cutoffHist[cutoffHist.length - 1].close };
      const indicators = TechnicalIndicators.calculateAll(cutoffHist);
      const technicalSignal = TechnicalIndicators.generateSignal(indicators, currentData.price);
      
      let targetPrice = TechnicalIndicators.calculateTargetPrice(indicators, currentData.price, technicalSignal.signal);
      const expectedReturn = ((targetPrice - currentData.price) / currentData.price) * 100;
      let volatility = indicators.atr14 / currentData.price;
      
      if (technicalSignal.signal !== 'SELL' && expectedReturn > 0) {
        analyzedStocks.push({
          symbol, historicalData: cutoffHist, currentData, price: currentData.price,
          expectedReturn, volatility, signal: technicalSignal.signal, confidence: technicalSignal.confidence
        });
      }
    }
    
    analyzedStocks.sort((a, b) => (b.expectedReturn / (b.volatility || 0.01)) - (a.expectedReturn / (a.volatility || 0.01)));
    const topCandidates = analyzedStocks.slice(0, 10);
    
    // AI Prediction: pass model_type=tuning to XGBoost microservice
    const axios = require('axios');
    for (const stock of topCandidates) {
      try {
        const res = await axios.post(`http://localhost:8000/predict/${stock.symbol}?model_type=tuning`, {
          current_price: stock.currentData.price,
          current_high: stock.currentData.price,
          current_low: stock.currentData.price
        });
        const prediction = res.data;
        if (prediction.action === 'BUY' && prediction.probability_up > 0.65) {
           stock.expectedReturn += 5; // AI boost
           stock.confidence += 10;
        }
      } catch (e) {}
    }
    
    topCandidates.sort((a, b) => (b.expectedReturn / (b.volatility || 0.01)) - (a.expectedReturn / (a.volatility || 0.01)));
    
    const maxSectorBudget = currentPortfolioValue * 0.25;
    const sectorAllocations = {};
    const maxPosBudget = currentPortfolioValue * 0.20;
    const minCashRequirement = currentPortfolioValue * 0.20;

    for (const stock of topCandidates) {
      if (cash <= minCashRequirement + 100) break;
      
      const stockInfo = dbService.db.prepare('SELECT sector FROM stocks WHERE symbol = ?').get(stock.symbol);
      const sector = stockInfo && stockInfo.sector ? stockInfo.sector : 'Unknown';
      const currentSectorAlloc = sectorAllocations[sector] || 0;
      
      if (currentSectorAlloc >= maxSectorBudget) continue;
      
      let actualAllocation = Math.min(maxPosBudget, cash - minCashRequirement);
      if (currentSectorAlloc + actualAllocation > maxSectorBudget) {
         actualAllocation = maxSectorBudget - currentSectorAlloc;
      }
      
      const quantity = Math.floor(actualAllocation / stock.price);
      if (quantity > 0) {
        cash -= (quantity * stock.price);
        sectorAllocations[sector] = currentSectorAlloc + (quantity * stock.price);
        currentPositions.push({ symbol: stock.symbol, quantity, buyPrice: stock.price, sector });
        console.log(`   🟢 BOUGHT ${quantity}x ${stock.symbol} at ₹${stock.price.toFixed(2)} (Alloc: ₹${(quantity * stock.price).toFixed(2)})`);
      }
    }
    
    let totalPositionValue = currentPositions.reduce((acc, pos) => acc + (pos.quantity * pos.buyPrice), 0);
    currentPortfolioValue = cash + totalPositionValue;
    console.log(`   💰 EOD Portfolio Value: ₹${currentPortfolioValue.toFixed(2)} (Cash: ₹${cash.toFixed(2)})`);
    equityCurve.push({ date: simulationTime.toISOString().split('T')[0], value: currentPortfolioValue });
  }
  
  const returnPct = (((currentPortfolioValue - budget) / budget) * 100).toFixed(2);
  
  let maxDrawdown = 0;
  let peak = budget;
  for (const p of equityCurve) {
    if (p.value > peak) peak = p.value;
    const dd = (peak - p.value) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = (maxDrawdown * 100).toFixed(2);
  
  console.log(`\n🎉 Backtest Complete!`);
  console.log(`Total Return: ${returnPct}% | Max Drawdown: ${maxDrawdownPct}%`);
  
  // Save to DB
  try {
    dbService.db.prepare(`
      INSERT INTO portfolio_backtests (start_date, end_date, starting_budget, final_value, return_pct, max_drawdown)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(equityCurve[0].date, equityCurve[equityCurve.length - 1].date, budget, currentPortfolioValue, returnPct, maxDrawdownPct);
  } catch(e) {
    console.error("Error saving backtest to DB:", e);
  }
  
  dbService.close();
  process.exit(0);
}

runPortfolioBacktest();
