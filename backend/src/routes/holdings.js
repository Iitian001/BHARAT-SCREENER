const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');
const yahooFinance = require('yahoo-finance2').default;

const db = getDatabase();

// Get all holdings
router.get('/', async (req, res) => {
  try {
    const openHoldings = db.getOpenHoldings();
    const closedHoldings = db.getClosedHoldings();
    
    // Fetch live prices for open holdings to calculate unrealized PnL
    const symbols = openHoldings.map(h => h.symbol);
    
    let quotes = [];
    if (symbols.length > 0) {
      quotes = await yahooFinance.quote(symbols);
      if (!Array.isArray(quotes)) quotes = [quotes];
    }
    
    const priceMap = {};
    quotes.forEach(q => priceMap[q.symbol] = q.regularMarketPrice);

    // Calculate current stats
    let totalInvested = 0;
    let currentValue = 0;

    const enrichedOpen = openHoldings.map(h => {
      const currentPrice = priceMap[h.symbol] || h.buy_price;
      const currentTotal = currentPrice * h.quantity;
      const pnl = currentTotal - h.invested_amount;
      const pnlPercent = (pnl / h.invested_amount) * 100;
      
      totalInvested += h.invested_amount;
      currentValue += currentTotal;
      
      return {
        ...h,
        current_price: currentPrice,
        current_value: currentTotal,
        unrealized_pnl: pnl,
        unrealized_pnl_percent: pnlPercent.toFixed(2)
      };
    });

    res.json({
      success: true,
      summary: {
        totalInvested,
        currentValue,
        totalUnrealizedPnl: currentValue - totalInvested,
        totalUnrealizedPnlPercent: totalInvested > 0 ? (((currentValue - totalInvested) / totalInvested) * 100).toFixed(2) : 0
      },
      openHoldings: enrichedOpen,
      closedHoldings
    });

  } catch (error) {
    console.error('Holdings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new holding (Buy)
router.post('/buy', async (req, res) => {
  try {
    const { symbol, quantity, buy_price, target_price, stop_loss, strategy_reason } = req.body;
    
    if (!symbol || !quantity || !buy_price) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const invested_amount = quantity * buy_price;
    
    const result = db.addHolding({
      symbol, quantity, buy_price, target_price, stop_loss, invested_amount, strategy_reason
    });
    
    res.json({ success: true, holdingId: result.lastInsertRowid });
  } catch (error) {
    console.error('Buy holding error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Close holding (Sell)
router.post('/sell/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sell_price } = req.body;
    
    if (!sell_price) {
      return res.status(400).json({ success: false, error: 'Missing sell_price' });
    }

    const result = db.closeHolding(id, sell_price);
    
    if (!result || result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Holding not found' });
    }
    
    res.json({ success: true, message: 'Holding closed successfully' });
  } catch (error) {
    console.error('Sell holding error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update stop loss
router.put('/stoploss/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stop_loss } = req.body;
    
    if (!stop_loss) {
      return res.status(400).json({ success: false, error: 'Missing stop_loss' });
    }

    db.updateStopLoss(id, stop_loss);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
