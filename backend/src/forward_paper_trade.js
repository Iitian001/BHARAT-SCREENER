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
  
  // 5. Check global win rate over the last 50 resolved trades
  checkGlobalWinRateAndKillSwitch();
  
  console.log("Forward paper trading log complete.");
}

function checkGlobalWinRateAndKillSwitch() {
  const recentTrades = dbInstance.db.prepare(`
    SELECT status FROM paper_trades 
    WHERE status IN ('WIN', 'LOSS') 
    ORDER BY resolved_at DESC LIMIT 50
  `).all();
  
  if (recentTrades.length < 10) return; // Not enough data
  
  const wins = recentTrades.filter(t => t.status === 'WIN').length;
  const winRate = wins / recentTrades.length;
  console.log(`[Risk Check] Recent Win Rate: ${(winRate * 100).toFixed(2)}% (${wins}/${recentTrades.length})`);
  
  if (winRate < 0.30) {
    console.error('🚨 [CRITICAL RISK] Win rate dropped below 30%. Triggering Automated Kill Switch.');
    const reason = `Automated Halt: Recent win rate is ${(winRate * 100).toFixed(2)}%`;
    try {
      dbInstance.db.prepare('INSERT INTO kill_switch_audit (reason, action) VALUES (?, ?)').run(reason, 'HALT');
    } catch (e) {
      console.error('Failed to write to kill_switch_audit:', e.message);
    }
  }
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
    SET status = ?, actual_outcome_price = ?, realized_return = ?, resolved_at = datetime('now')
    WHERE id = ?
  `);
  
  for (const trade of openTrades) {
    const returnPct = ((currentPrice - trade.price) / trade.price) * 100;
    const isWin = (trade.action === 'BUY' && returnPct > 0) || (trade.action === 'SELL' && returnPct < 0);
    const newStatus = isWin ? 'WIN' : 'LOSS';
    
    resolveStmt.run(newStatus, currentPrice, returnPct, trade.id);
    console.log(`[Paper Trade Resolved] ${symbol} ${trade.action} @ ${trade.price} -> ${currentPrice} | Return: ${returnPct.toFixed(2)}% | ${newStatus}`);
  }
}

if (require.main === module) {
  runForwardPaperTrades().then(() => process.exit(0));
}
