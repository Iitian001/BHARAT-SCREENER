/**
 * Local SQLite Database Service
 * All data stored locally - no cloud dependencies
 */

const Database = require('better-sqlite3');
const path = require('path');

class DatabaseService {
  constructor() {
    // Store database in backend/data directory
    const dbPath = path.join(__dirname, '../../data/stocks.db');
    
    // Ensure data directory exists
    const fs = require('fs');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better performance
    
    this.initializeTables();
    console.log('🗄️  SQLite database initialized at:', dbPath);
  }

  initializeTables() {
    // Stock master table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stocks (
        symbol TEXT PRIMARY KEY,
        name TEXT,
        exchange TEXT DEFAULT 'NSE',
        token TEXT,
        isin TEXT,
        sector TEXT,
        industry TEXT,
        market_cap REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Historical price data (can store 15+ years)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER,
        oi INTEGER DEFAULT 0,
        timeframe TEXT DEFAULT '1d',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, timestamp, timeframe)
      )
    `);

    // Paper-Trading Audit Log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        price REAL NOT NULL,
        target_price REAL,
        stop_loss REAL,
        quantity INTEGER NOT NULL,
        status TEXT DEFAULT 'OPEN',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tick-by-tick data storage
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tick_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        token TEXT,
        timestamp DATETIME NOT NULL,
        ltp REAL,
        quantity INTEGER,
        trade_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Intraday data (1-minute candles)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intraday_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER,
        vwap REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, timestamp)
      )
    `);

    // ML predictions history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        prediction_type TEXT DEFAULT 'BUY',
        confidence REAL,
        predicted_price REAL,
        actual_price REAL,
        target_price REAL,
        stop_loss REAL,
        quantity INTEGER,
        risk_reward_ratio REAL,
        indicators JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        outcome TEXT,
        UNIQUE(symbol, created_at)
      )
    `);

    // Company details cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS company_details (
        symbol TEXT PRIMARY KEY,
        name TEXT,
        sector TEXT,
        industry TEXT,
        market_cap REAL,
        pe_ratio REAL,
        pb_ratio REAL,
        dividend_yield REAL,
        roe REAL,
        roce REAL,
        face_value REAL,
        book_value REAL,
        eps REAL,
        revenue REAL,
        profit REAL,
        debt_equity REAL,
        promoter_holding REAL,
        fii_holding REAL,
        dii_holding REAL,
        public_holding REAL,
        about TEXT,
        website TEXT,
        exchange TEXT,
        isin TEXT,
        listing_date TEXT,
        high_52w REAL,
        low_52w REAL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Holdings (Simulated Paper Trading Portfolio)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        buy_price REAL NOT NULL,
        target_price REAL,
        stop_loss REAL,
        invested_amount REAL,
        strategy_reason TEXT,
        status TEXT DEFAULT 'OPEN', -- OPEN or CLOSED
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        sell_price REAL,
        realized_pnl REAL
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tick_data_symbol ON tick_data(symbol);
      CREATE INDEX IF NOT EXISTS idx_tick_data_timestamp ON tick_data(timestamp);
      CREATE INDEX IF NOT EXISTS idx_intraday_symbol ON intraday_data(symbol);
      CREATE INDEX IF NOT EXISTS idx_predictions_symbol ON predictions(symbol);
    `);
  }

  // ==================== Stock Operations ====================

  upsertStock(stock) {
    const stmt = this.db.prepare(`
      INSERT INTO stocks (symbol, name, exchange, token, isin, sector, industry, market_cap, updated_at)
      VALUES (@symbol, @name, @exchange, @token, @isin, @sector, @industry, @market_cap, datetime('now'))
      ON CONFLICT(symbol) DO UPDATE SET
        name = excluded.name,
        exchange = excluded.exchange,
        token = excluded.token,
        isin = excluded.isin,
        sector = excluded.sector,
        industry = excluded.industry,
        market_cap = excluded.market_cap,
        updated_at = datetime('now')
    `);
    return stmt.run(stock);
  }

  getStock(symbol) {
    const stmt = this.db.prepare('SELECT * FROM stocks WHERE symbol = ?');
    return stmt.get(symbol);
  }

  getAllStocks() {
    const stmt = this.db.prepare('SELECT * FROM stocks ORDER BY symbol');
    return stmt.all();
  }

  searchStocks(query) {
    const stmt = this.db.prepare(`
      SELECT * FROM stocks 
      WHERE symbol LIKE ? OR name LIKE ?
      ORDER BY symbol
      LIMIT 50
    `);
    const searchPattern = `%${query}%`;
    return stmt.all(searchPattern, searchPattern);
  }

  // ==================== Price History Operations ====================

  insertPriceHistory(data) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO price_history 
      (symbol, timestamp, open, high, low, close, volume, timeframe)
      VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume, @timeframe)
    `);
    return stmt.run(data);
  }

  bulkInsertPriceHistory(records) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO price_history 
      (symbol, timestamp, open, high, low, close, volume, timeframe)
      VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume, @timeframe)
    `);
    
    const insertMany = this.db.transaction((items) => {
      for (const item of items) stmt.run(item);
    });
    
    return insertMany(records);
  }

  getPriceHistory(symbol, options = {}) {
    const { days = 365, timeframe = '1d', limit } = options;
    
    let query = `
      SELECT * FROM price_history 
      WHERE symbol = ? AND timeframe = ?
      ORDER BY timestamp DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    } else if (days) {
      query = `
        SELECT * FROM price_history 
        WHERE symbol = ? AND timeframe = ?
        AND timestamp >= datetime('now', '-${days} days')
        ORDER BY timestamp ASC
      `;
    }
    
    const stmt = this.db.prepare(query);
    return stmt.all(symbol, timeframe);
  }

  // Get 15 years of historical data
  getLongTermHistory(symbol) {
    const stmt = this.db.prepare(`
      SELECT * FROM price_history 
      WHERE symbol = ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(symbol);
  }

  // ==================== Tick Data Operations ====================

  insertTickData(tick) {
    const stmt = this.db.prepare(`
      INSERT INTO tick_data (symbol, token, timestamp, ltp, quantity, trade_type)
      VALUES (@symbol, @token, @timestamp, @ltp, @quantity, @trade_type)
    `);
    return stmt.run(tick);
  }

  getTickData(symbol, options = {}) {
    const { minutes = 60 } = options;
    const stmt = this.db.prepare(`
      SELECT * FROM tick_data 
      WHERE symbol = ?
      AND timestamp >= datetime('now', '-${minutes} minutes')
      ORDER BY timestamp DESC
    `);
    return stmt.all(symbol);
  }

  // Clean old tick data (keep last 24 hours)
  cleanOldTickData() {
    const stmt = this.db.prepare(`
      DELETE FROM tick_data 
      WHERE timestamp < datetime('now', '-24 hours')
    `);
    return stmt.run();
  }

  // ==================== Intraday Data Operations ====================

  insertIntradayCandle(data) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO intraday_data 
      (symbol, timestamp, open, high, low, close, volume, vwap)
      VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume, @vwap)
    `);
    return stmt.run(data);
  }

  getIntradayData(symbol) {
    const stmt = this.db.prepare(`
      SELECT * FROM intraday_data 
      WHERE symbol = ?
      AND timestamp >= date('now')
      ORDER BY timestamp ASC
    `);
    return stmt.all(symbol);
  }

  // ==================== Predictions Operations ====================

  savePrediction(prediction) {
    const stmt = this.db.prepare(`
      INSERT INTO predictions 
      (symbol, prediction_type, confidence, predicted_price, actual_price,
       target_price, stop_loss, quantity, risk_reward_ratio, indicators)
      VALUES (@symbol, @prediction_type, @confidence, @predicted_price, @actual_price,
              @target_price, @stop_loss, @quantity, @risk_reward_ratio, @indicators)
    `);
    return stmt.run({
      ...prediction,
      indicators: JSON.stringify(prediction.indicators || {})
    });
  }

  getPredictions(symbol, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM predictions 
      WHERE symbol = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(symbol, limit);
    return rows.map(r => ({
      ...r,
      indicators: JSON.parse(r.indicators || '{}')
    }));
  }

  resolvePrediction(id, actualPrice, outcome) {
    const stmt = this.db.prepare(`
      UPDATE predictions 
      SET actual_price = ?, outcome = ?, resolved_at = datetime('now')
      WHERE id = ?
    `);
    return stmt.run(actualPrice, outcome, id);
  }

  getPredictionAccuracy(days = 30) {
    const stmt = this.db.prepare(`
      SELECT 
        prediction_type,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'SUCCESS' THEN 1 ELSE 0 END) as success,
        AVG(CASE WHEN outcome IS NOT NULL THEN 
          ABS(predicted_price - actual_price) / predicted_price * 100 
        END) as avg_error_pct
      FROM predictions
      WHERE resolved_at IS NOT NULL
      AND created_at >= datetime('now', '-${days} days')
      GROUP BY prediction_type
    `);
    return stmt.all();
  }

  // ==================== Company Details Operations ====================

  upsertCompanyDetails(details) {
    const stmt = this.db.prepare(`
      INSERT INTO company_details (
        symbol, name, sector, industry, market_cap, pe_ratio, pb_ratio,
        dividend_yield, roe, roce, face_value, book_value, eps,
        revenue, profit, debt_equity, promoter_holding, fii_holding,
        dii_holding, public_holding, about, website, exchange, isin,
        listing_date, high_52w, low_52w, updated_at
      ) VALUES (
        @symbol, @name, @sector, @industry, @market_cap, @pe_ratio, @pb_ratio,
        @dividend_yield, @roe, @roce, @face_value, @book_value, @eps,
        @revenue, @profit, @debt_equity, @promoter_holding, @fii_holding,
        @dii_holding, @public_holding, @about, @website, @exchange, @isin,
        @listing_date, @high_52w, @low_52w, datetime('now')
      )
      ON CONFLICT(symbol) DO UPDATE SET
        name = excluded.name,
        sector = excluded.sector,
        industry = excluded.industry,
        market_cap = excluded.market_cap,
        pe_ratio = excluded.pe_ratio,
        pb_ratio = excluded.pb_ratio,
        dividend_yield = excluded.dividend_yield,
        roe = excluded.roe,
        roce = excluded.roce,
        face_value = excluded.face_value,
        book_value = excluded.book_value,
        eps = excluded.eps,
        revenue = excluded.revenue,
        profit = excluded.profit,
        debt_equity = excluded.debt_equity,
        promoter_holding = excluded.promoter_holding,
        fii_holding = excluded.fii_holding,
        dii_holding = excluded.dii_holding,
        public_holding = excluded.public_holding,
        about = excluded.about,
        website = excluded.website,
        listing_date = excluded.listing_date,
        high_52w = excluded.high_52w,
        low_52w = excluded.low_52w,
        updated_at = datetime('now')
    `);
    return stmt.run(details);
  }

  getCompanyDetails(symbol) {
    const stmt = this.db.prepare('SELECT * FROM company_details WHERE symbol = ?');
    return stmt.get(symbol);
  }

  // ==================== Holdings Operations ====================

  addHolding(holding) {
    const stmt = this.db.prepare(`
      INSERT INTO holdings (symbol, quantity, buy_price, target_price, stop_loss, invested_amount, strategy_reason)
      VALUES (@symbol, @quantity, @buy_price, @target_price, @stop_loss, @invested_amount, @strategy_reason)
    `);
    return stmt.run(holding);
  }

  getOpenHoldings() {
    const stmt = this.db.prepare("SELECT * FROM holdings WHERE status = 'OPEN' ORDER BY created_at DESC");
    return stmt.all();
  }
  
  getClosedHoldings() {
    const stmt = this.db.prepare("SELECT * FROM holdings WHERE status = 'CLOSED' ORDER BY closed_at DESC");
    return stmt.all();
  }

  closeHolding(id, sellPrice) {
    // First get the holding to calculate PNL
    const holding = this.db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!holding) return null;
    
    const realizedPnl = (sellPrice - holding.buy_price) * holding.quantity;
    
    const stmt = this.db.prepare(`
      UPDATE holdings 
      SET status = 'CLOSED', closed_at = datetime('now'), sell_price = ?, realized_pnl = ?
      WHERE id = ?
    `);
    return stmt.run(sellPrice, realizedPnl, id);
  }

  updateStopLoss(id, newStopLoss) {
    const stmt = this.db.prepare(`UPDATE holdings SET stop_loss = ? WHERE id = ?`);
    return stmt.run(newStopLoss, id);
  }

  // ==================== Paper Trading Operations ====================

  logPaperTrade(trade) {
    const stmt = this.db.prepare(`
      INSERT INTO paper_trades (symbol, action, confidence, price, target_price, stop_loss, quantity)
      VALUES (@symbol, @action, @confidence, @price, @target_price, @stop_loss, @quantity)
    `);
    return stmt.run(trade);
  }

  getPaperTrades() {
    const stmt = this.db.prepare("SELECT * FROM paper_trades ORDER BY timestamp DESC LIMIT 50");
    return stmt.all();
  }

  // ==================== Statistics ====================

  getStats() {
    const stats = {};
    
    stats.stocks = this.db.prepare('SELECT COUNT(*) as count FROM stocks').get().count;
    stats.priceHistory = this.db.prepare('SELECT COUNT(*) as count FROM price_history').get().count;
    stats.tickData = this.db.prepare('SELECT COUNT(*) as count FROM tick_data').get().count;
    stats.predictions = this.db.prepare('SELECT COUNT(*) as count FROM predictions').get().count;
    stats.companies = this.db.prepare('SELECT COUNT(*) as count FROM company_details').get().count;
    
    // Database size
    const dbPath = this.db.name;
    const fs = require('fs');
    if (fs.existsSync(dbPath)) {
      stats.dbSizeBytes = fs.statSync(dbPath).size;
      stats.dbSizeMB = (stats.dbSizeBytes / 1024 / 1024).toFixed(2);
    }
    
    return stats;
  }

  // Close database connection
  close() {
    this.db.close();
    console.log('📑 Database connection closed');
  }
}

// Singleton instance
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
  }
  return dbInstance;
}

module.exports = { DatabaseService, getDatabase };
