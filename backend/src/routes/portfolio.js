const express = require('express');
const router = express.Router();
const HistoricalDataService = require('../services/historicalDataService');
const TechnicalIndicators = require('../ml/technicalIndicators');
const mlModel = require('../ml/mlModel');
const dbService = require('../services/database');

function calculateReturnCorrelation(hist1, hist2, days = 60) {
  if (!hist1 || !hist2 || hist1.length < 10 || hist2.length < 10) return 0;

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
  if (ret1.length < 10 || ret2.length < 10) return 0;
  
  const mean1 = ret1.reduce((a,b) => a+b, 0) / ret1.length;
  const mean2 = ret2.reduce((a,b) => a+b, 0) / ret2.length;
  
  if (isNaN(mean1) || isNaN(mean2)) return 0;
  
  let num = 0, den1 = 0, den2 = 0;
  for(let i=0; i<ret1.length; i++) {
    const diff1 = ret1[i] - mean1, diff2 = ret2[i] - mean2;
    num += (diff1 * diff2);
    den1 += diff1 * diff1;
    den2 += diff2 * diff2;
  }
  if (den1 === 0 || den2 === 0) return 0;
  
  const corr = num / Math.sqrt(den1 * den2);
  if (isNaN(corr) || corr === undefined) return 0;
  return corr;
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
          const reason = `High correlation (${corr.toFixed(2)}) with ${selected.symbol}`;
          console.log(`[Portfolio] Rejecting ${stock.symbol} due to ${reason}`);
          dbInstance.logPortfolioRejection(stock.symbol, reason);
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
        const reason = `Sector ${sector} already at ${sectorCapPct}% cap.`;
        console.log(`[Portfolio] Rejecting ${stock.symbol}: ${reason}`);
        dbInstance.logPortfolioRejection(stock.symbol, reason);
        continue;
      }

      let kellyFraction = 0;
      let p, q, riskPct, rewardPct, b;
      try {
        p = Math.min(stock.confidence / 100, 0.95);
        q = 1 - p;
        riskPct = stock.volatility || 0.02;
        rewardPct = stock.expectedReturn / 100;
        
        b = rewardPct / riskPct;
        if (b > 0) kellyFraction = p - (q / b);
        
        // Half-Kelly
        kellyFraction = Math.max(0.01, Math.min(kellyFraction / 2, 0.4));
        if (isNaN(kellyFraction)) kellyFraction = 0.01;
        
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
      } catch (err) {
        console.error(`[Portfolio] Error processing Kelly allocation for ${stock.symbol}:`, err.message);
        dbInstance.logPortfolioRejection(stock.symbol, 'Error processing Kelly allocation');
      }
    }
        console.warn(`[Portfolio] Error allocating ${stock.symbol}:`, err.message);
      }
    }

    console.log(`[Portfolio] ✅ Done! Scanned ${scanned} stocks, selected ${portfolio.length} for portfolio.`);
    
    // Calculate aggregate portfolio risk (Volatility & Drawdown)
    let portfolioVolatility = 0;
    let expectedDrawdown = 0;
    
    if (portfolio.length > 0 && selectedStocks.length > 0) {
      let minLen = Math.min(...selectedStocks.map(s => s.historicalData.length));
      minLen = Math.min(minLen, 60); // Use last 60 days
      
      const portReturns = new Array(minLen).fill(0);
      let totalInvested = budget - remainingBudget;
      
      for (const stock of selectedStocks) {
        const portItem = portfolio.find(p => p.symbol === stock.symbol);
        if (!portItem) continue;
        const weight = portItem.totalInvestment / totalInvested;
        
        const hist = stock.historicalData.slice(-minLen - 1);
        for (let i = 1; i <= minLen; i++) {
          if (hist[i] && hist[i-1] && hist[i-1].close > 0) {
             const ret = (hist[i].close - hist[i-1].close) / hist[i-1].close;
             portReturns[i-1] += (ret * weight);
          }
        }
      }
      
      const meanRet = portReturns.reduce((a, b) => a + b, 0) / minLen;
      const variance = portReturns.reduce((acc, val) => acc + Math.pow(val - meanRet, 2), 0) / minLen;
      portfolioVolatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
      
      let maxDrawdown = 0;
      let peak = 1;
      let currentEq = 1;
      for (const ret of portReturns) {
        currentEq *= (1 + ret);
        if (currentEq > peak) peak = currentEq;
        const dd = (peak - currentEq) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
      expectedDrawdown = maxDrawdown * 100;
    }

    return res.json({
      success: true,
      budget,
      stocksScanned: scanned,
      investedAmount: budget - remainingBudget,
      remainingCash: remainingBudget,
      overallExpectedReturn: ((totalExpectedProfit / (budget - remainingBudget)) * 100).toFixed(2),
      estimatedProfit: totalExpectedProfit,
      portfolioVolatility: portfolioVolatility.toFixed(2) + '%',
      expectedDrawdown: expectedDrawdown.toFixed(2) + '%',
      portfolio
    });

  } catch (error) {
    console.error('[Portfolio] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate portfolio' });
  }
});

// Helper for correlation
function calculateReturnCorrelation(hist1, hist2, days = 60) {
  if (!hist1 || !hist2 || hist1.length < days || hist2.length < days) return 0;
  
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

  const mean1 = ret1.reduce((a, b) => a + b, 0) / ret1.length;
  const mean2 = ret2.reduce((a, b) => a + b, 0) / ret2.length;
  
  let num = 0, den1 = 0, den2 = 0;
  for (let i = 0; i < ret1.length; i++) {
    const d1 = ret1[i] - mean1;
    const d2 = ret2[i] - mean2;
    num += (d1 * d2);
    den1 += (d1 * d1);
    den2 += (d2 * d2);
  }
  
  if (den1 === 0 || den2 === 0) return 0;
  const corr = num / Math.sqrt(den1 * den2);
  return isNaN(corr) ? 0 : corr;
}

module.exports = router;
