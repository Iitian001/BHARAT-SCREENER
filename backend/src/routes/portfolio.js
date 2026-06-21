const express = require('express');
const router = express.Router();
const HistoricalDataService = require('../services/historicalDataService');
const TechnicalIndicators = require('../ml/technicalIndicators');
const mlModel = require('../ml/mlModel');

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

    // PHASE 5: Allocate Budget Using Kelly Criterion
    const portfolio = [];
    let remainingBudget = budget;
    let totalExpectedProfit = 0;
    
    // Sort by confidence/expected return to allocate to the best setups first
    topCandidates.sort((a, b) => b.confidence - a.confidence);

    for (const stock of topCandidates) {
      if (remainingBudget <= 100) break; // Minimum budget threshold

      // Kelly Criterion: f* = p - (q / b)
      // p = probability of winning (confidence)
      // q = probability of losing (1 - p)
      // b = Reward / Risk ratio
      
      const p = Math.min(stock.confidence / 100, 0.95); // Max 95% confidence
      const q = 1 - p;
      const riskPct = stock.volatility || 0.02; // Default 2% risk
      const rewardPct = stock.expectedReturn / 100;
      
      const b = rewardPct / riskPct;
      
      let kellyFraction = 0;
      if (b > 0) {
        kellyFraction = p - (q / b);
      }
      
      // Half-Kelly for safety
      kellyFraction = Math.max(0.01, Math.min(kellyFraction / 2, 0.4)); // Max 40% per stock
      
      const targetAllocation = budget * kellyFraction;
      const actualAllocation = Math.min(targetAllocation, remainingBudget);
      
      const quantity = Math.floor(actualAllocation / stock.price);
      
      if (quantity > 0) {
        const cost = quantity * stock.price;
        const profit = cost * rewardPct;
        
        // Trailing Stop Loss (2x ATR below current price)
        const trailingStopLoss = stock.price - (stock.price * riskPct * 2);

        portfolio.push({
          symbol: stock.symbol,
          allocationPercent: Math.round((cost / budget) * 100),
          quantity: quantity,
          buyPrice: stock.price,
          totalInvestment: cost,
          expectedReturnPercent: stock.expectedReturn.toFixed(2),
          targetPrice: (stock.price * (1 + rewardPct)).toFixed(2),
          stopLoss: trailingStopLoss.toFixed(2), // New: Trailing Stop Loss
          estimatedProfit: profit,
          kellyFraction: (kellyFraction * 100).toFixed(1) + '%'
        });
        
        remainingBudget -= cost;
        totalExpectedProfit += profit;
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
