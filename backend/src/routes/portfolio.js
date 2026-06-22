const express = require('express');
const router = express.Router();
const HistoricalDataService = require('../services/historicalDataService');
const TechnicalIndicators = require('../ml/technicalIndicators');
const mlModel = require('../ml/mlModel');
const dbService = require('../services/database');

function calculateReturnCorrelation(hist1, hist2, days = 60) {
  const map2 = new Map(hist2.map(h => [h.timestamp, h.close]));
  let ret1 = [], ret2 = [];
  
  for (let i = 1; i < hist1.length; i++) {
    const ts = hist1[i].timestamp;
    const prevTs = hist1[i-1].timestamp;
    if (map2.has(ts) && map2.has(prevTs)) {
      const prev1 = hist1[i-1].close, curr1 = hist1[i].close;
      const prev2 = map2.get(prevTs), curr2 = map2.get(ts);
      if (prev1 > 0 && prev2 > 0) {
        ret1.push((curr1 - prev1) / prev1);
        ret2.push((curr2 - prev2) / prev2);
      }
    }
  }
  
  ret1 = ret1.slice(-days);
  ret2 = ret2.slice(-days);
  if (ret1.length < 10) return 0;
  
  const mean1 = ret1.reduce((a,b) => a+b, 0) / ret1.length;
  const mean2 = ret2.reduce((a,b) => a+b, 0) / ret2.length;
  
  let num = 0, den1 = 0, den2 = 0;
  for(let i=0; i<ret1.length; i++) {
    const diff1 = ret1[i] - mean1, diff2 = ret2[i] - mean2;
    num += (diff1 * diff2);
    den1 += diff1 * diff1;
    den2 += diff2 * diff2;
  }
  if (den1 === 0 || den2 === 0) return 0;
  return num / Math.sqrt(den1 * den2);
}

router.post('/generate', async (req, res) => {
  try {
    const { budget, risk, term } = req.body;
    
    if (!budget || budget < 1000) {
      return res.status(400).json({ success: false, error: 'Minimum budget of ₹1000 required' });
    }

    console.log(`[Portfolio] Generating ${risk} risk, ${term} term portfolio for ₹${budget}...`);
    console.log(`[Portfolio] Phase 1: Scanning ALL cached stocks from local database...`);

    const _histService = new HistoricalDataService();

    // PHASE 1: Get ALL stocks that have cached data in SQLite
    const cachedSymbols = _histService.getAllCachedSymbols();
    console.log(`[Portfolio] Found ${cachedSymbols.length} stocks with cached data. Running technical analysis on all...`);

    if (cachedSymbols.length === 0) {
      return res.json({ 
        success: false, 
        error: 'No cached stock data yet. The background pre-loader is still downloading. Please wait a few minutes and try again.' 
      });
    }

    // PHASE 2: Run FAST technical analysis on ALL cached stocks (pure math, no network)
    const analyzedStocks = [];
    let scanned = 0;

    for (const { symbol } of cachedSymbols) {
      try {
        const historicalData = _histService.getStoredHistoricalData(symbol, 1);
        if (!historicalData || historicalData.length < 50) continue;

        const currentData = { price: historicalData[historicalData.length - 1].close };
        if (!currentData.price || currentData.price <= 0) continue;

        const indicators = TechnicalIndicators.calculateAll(historicalData);
        const technicalSignal = TechnicalIndicators.generateSignal(indicators, currentData.price);
        
        let volatility = indicators.atr14 / currentData.price;
        let targetPrice = TechnicalIndicators.calculateTargetPrice(indicators, currentData.price, technicalSignal.signal);
        const expectedReturn = ((targetPrice - currentData.price) / currentData.price) * 100;
        
        analyzedStocks.push({
          symbol,
          historicalData,
          currentData,
          price: currentData.price,
          expectedReturn,
          volatility,
          signal: technicalSignal.signal,
          confidence: technicalSignal.confidence
        });

        scanned++;
      } catch (err) {
        // Skip stocks that fail analysis silently
      }
    }

    console.log(`[Portfolio] Phase 2 complete: Analyzed ${scanned} stocks. Filtering best candidates...`);

    // PHASE 3: Filter based on user risk profile
    let filtered = analyzedStocks.filter(s => s.signal !== 'SELL' && s.expectedReturn > 0);
    
    if (risk === 'Low') {
      filtered = filtered.filter(s => s.volatility < 0.02).sort((a, b) => b.confidence - a.confidence);
    } else if (risk === 'High') {
      filtered = filtered.sort((a, b) => b.expectedReturn - a.expectedReturn);
    } else {
      filtered = filtered.sort((a, b) => (b.expectedReturn / (b.volatility || 0.01)) - (a.expectedReturn / (a.volatility || 0.01)));
    }

    console.log(`[Portfolio] ${filtered.length} stocks passed filters. Running Deep Learning on top 10...`);

    // PHASE 4: HEAVY AI — Train LSTM on top 10 candidates for maximum accuracy
    const topCandidates = filtered.slice(0, 10);
    
    for (const stock of topCandidates) {
      try {
        let cachedModel = mlModel.models.get(stock.symbol);
        if (!cachedModel || (Date.now() - cachedModel.lastTrained > 24 * 60 * 60 * 1000)) {
           await mlModel.trainModelForSymbol(stock.symbol, stock.historicalData);
        }
        const prediction = await mlModel.predictAsync({ 
          historicalData: stock.historicalData, 
          currentData: stock.currentData, 
          symbol: stock.symbol 
        });
        
        if (prediction.targetPrice && prediction.targetPrice > stock.price) {
           stock.targetPrice = prediction.targetPrice;
           stock.expectedReturn = ((prediction.targetPrice - stock.price) / stock.price) * 100;
           if (prediction.confidence > 60) stock.confidence += 10;
        }
      } catch (e) {
        console.warn(`[Portfolio DL Pass] Error predicting ${stock.symbol}:`, e.message);
      }
    }

    // Re-sort after AI evaluation
    if (risk === 'Low') {
      topCandidates.sort((a, b) => b.confidence - a.confidence);
    } else if (risk === 'High') {
      topCandidates.sort((a, b) => b.expectedReturn - a.expectedReturn);
    } else {
      topCandidates.sort((a, b) => (b.expectedReturn / (b.volatility || 0.01)) - (a.expectedReturn / (a.volatility || 0.01)));
    }

    // PHASE 5: Allocate Budget Using Kelly Criterion, Sector Caps, and Correlation check
    const portfolio = [];
    let remainingBudget = budget;
    let totalExpectedProfit = 0;
    
    const dbInstance = dbService.getDatabase();
    const sectorCapPct = req.body.sectorCap || 25;
    const maxSectorBudget = budget * (sectorCapPct / 100);
    const sectorAllocations = {};
    const selectedStocks = [];
    
    // Global ranking: Sharpe contribution (Expected Return / Volatility)
    topCandidates.sort((a, b) => (b.expectedReturn / (b.volatility || 0.01)) - (a.expectedReturn / (a.volatility || 0.01)));

    for (const stock of topCandidates) {
      if (remainingBudget <= 100) break; // Minimum budget threshold

      // Correlation Check (> 0.7 reject)
      let tooCorrelated = false;
      for (const selected of selectedStocks) {
        const corr = calculateReturnCorrelation(stock.historicalData, selected.historicalData, 60);
        if (corr > 0.7) {
          console.log(`[Portfolio] Rejecting ${stock.symbol} due to high correlation (${corr.toFixed(2)}) with ${selected.symbol}`);
          tooCorrelated = true;
          break;
        }
      }
      if (tooCorrelated) continue;

      // Sector Cap Check
      const stockInfo = dbInstance.db.prepare('SELECT sector FROM stocks WHERE symbol = ?').get(stock.symbol);
      const sector = stockInfo && stockInfo.sector ? stockInfo.sector : 'Unknown';
      const currentSectorAlloc = sectorAllocations[sector] || 0;
      if (currentSectorAlloc >= maxSectorBudget) {
        console.log(`[Portfolio] Rejecting ${stock.symbol}: Sector ${sector} already at ${sectorCapPct}% cap.`);
        continue;
      }

      const p = Math.min(stock.confidence / 100, 0.95);
      const q = 1 - p;
      const riskPct = stock.volatility || 0.02;
      const rewardPct = stock.expectedReturn / 100;
      
      const b = rewardPct / riskPct;
      let kellyFraction = 0;
      if (b > 0) kellyFraction = p - (q / b);
      
      // Half-Kelly
      kellyFraction = Math.max(0.01, Math.min(kellyFraction / 2, 0.4));
      
      const targetAllocation = budget * kellyFraction;
      let actualAllocation = Math.min(targetAllocation, remainingBudget);
      
      // Reduce allocation if it breaches sector cap
      if (currentSectorAlloc + actualAllocation > maxSectorBudget) {
        actualAllocation = maxSectorBudget - currentSectorAlloc;
      }
      
      const quantity = Math.floor(actualAllocation / stock.price);
      
      if (quantity > 0) {
        const cost = quantity * stock.price;
        const profit = cost * rewardPct;
        const trailingStopLoss = stock.price - (stock.price * riskPct * 2);

        portfolio.push({
          symbol: stock.symbol,
          sector: sector,
          allocationPercent: Math.round((cost / budget) * 100),
          quantity: quantity,
          buyPrice: stock.price,
          totalInvestment: cost,
          expectedReturnPercent: stock.expectedReturn.toFixed(2),
          targetPrice: (stock.price * (1 + rewardPct)).toFixed(2),
          stopLoss: trailingStopLoss.toFixed(2),
          estimatedProfit: profit,
          kellyFraction: (kellyFraction * 100).toFixed(1) + '%'
        });
        
        remainingBudget -= cost;
        totalExpectedProfit += profit;
        sectorAllocations[sector] = currentSectorAlloc + cost;
        selectedStocks.push(stock);
      }
    }

    if (portfolio.length === 0) {
      return res.json({ success: false, error: 'Budget is too low to buy a diversified basket of top stocks.' });
    }

    const overallRiskReward = (totalExpectedProfit / budget) * 100;

    console.log(`[Portfolio] ✅ Done! Scanned ${scanned} stocks, selected ${portfolio.length} for portfolio.`);

    res.json({
      success: true,
      budget,
      stocksScanned: scanned,
      investedAmount: budget - remainingBudget,
      remainingCash: remainingBudget,
      overallExpectedReturn: overallRiskReward.toFixed(2),
      estimatedProfit: totalExpectedProfit,
      portfolio
    });

  } catch (error) {
    console.error('Portfolio generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
