const dbService = require('./services/database');
const HistoricalDataService = require('./services/historicalDataService');

const dbInstance = dbService.getDatabase();
const histService = new HistoricalDataService();

async function runForwardPaperTrades() {
  console.log("Starting forward paper trading log generation...");
  
  // Get all symbols
  const stmt = dbInstance.db.prepare(`
    SELECT symbol FROM price_history 
    GROUP BY symbol 
    HAVING count(timestamp) >= 50
  `);
  const symbols = stmt.all().map(r => r.symbol);
  
  for (const symbol of symbols) {
    try {
      // 1. Check if there are unresolved paper trades older than 5 days, and score them
      resolveOldTrades(symbol);
      
      // 2. Fetch latest data
      const data = histService.getStoredHistoricalData(symbol, 1);
      if (!data || data.length < 50) continue;
      
      const latestData = data[data.length - 1];
      
      // 3. Make prediction
      // For now we'll fetch prediction using xgboost microservice via HTTP
      const axios = require('axios');
      let prediction = null;
      try {
        const res = await axios.post(`http://localhost:8000/predict/${symbol}`, {
          current_price: latestData.close,
          current_high: latestData.high,
          current_low: latestData.low
        });
        prediction = res.data;
      } catch (e) {
        console.warn(`Could not get XGBoost prediction for ${symbol}. Skipping.`);
        continue;
      }
      
      if (!prediction || prediction.action === 'HOLD') continue;
      
      // 4. Log to paper_trades table
      const insertStmt = dbInstance.db.prepare(`
        INSERT INTO paper_trades (
          symbol, action, confidence, price, quantity
        ) VALUES (
          ?, ?, ?, ?, ?
        )
      `);
      
      const conf = Math.round(prediction.probability_up * 100);
      
      insertStmt.run(symbol, prediction.action, conf, latestData.close, 1); // Mock quantity 1
      console.log(`[Paper Trade Logged] ${symbol} -> ${prediction.action} @ ${latestData.close} (Conf: ${conf}%)`);
      
    } catch (err) {
      console.error(`Error processing paper trade for ${symbol}:`, err.message);
    }
  }
  
  console.log("Forward paper trading log complete.");
}

function resolveOldTrades(symbol) {
  // Find open trades older than 5 days
  const openTrades = dbInstance.db.prepare(`
    SELECT * FROM paper_trades 
    WHERE symbol = ? AND status = 'OPEN' 
      AND datetime(timestamp) <= datetime('now', '-5 days')
  `).all(symbol);
  
  if (openTrades.length === 0) return;
  
  const latestData = histService.getStoredHistoricalData(symbol, 1);
  if (!latestData || latestData.length === 0) return;
  
  const currentPrice = latestData[latestData.length - 1].close;
  
  const resolveStmt = dbInstance.db.prepare(`
    UPDATE paper_trades 
    SET status = 'RESOLVED', actual_outcome_price = ?, resolved_at = datetime('now')
    WHERE id = ?
  `);
  
  for (const trade of openTrades) {
    resolveStmt.run(currentPrice, trade.id);
    const returnPct = ((currentPrice - trade.price) / trade.price) * 100;
    const isWin = (trade.action === 'BUY' && returnPct > 0) || (trade.action === 'SELL' && returnPct < 0);
    console.log(`[Paper Trade Resolved] ${symbol} ${trade.action} @ ${trade.price} -> ${currentPrice} | Return: ${returnPct.toFixed(2)}% | ${isWin ? '✅ WIN' : '❌ LOSS'}`);
  }
}

if (require.main === module) {
  runForwardPaperTrades().then(() => process.exit(0));
}
