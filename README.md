# BHARAT SCREENER

Bharat Screener is a real-time, comprehensive Indian stock market screener, backtesting engine, and paper-trading simulator. It monitors the top Indian stocks and generates pattern-matching predictions using a local ML pipeline and technical indicators.

> **⚠️ IMPORTANT DISCLAIMER:**
> This software is strictly for **educational and paper-trading purposes only**. The integrated ML models (LSTM/TensorFlow.js) are experimental pattern matchers trained on limited historical data. They do **not** constitute financial advice and have no statistical power to guarantee future price movements. Always perform your own rigorous backtesting before considering any algorithmic trading strategy with real capital.

## Features

- **Real-Time Screener:** Monitors NSE/BSE stocks via WebSockets.
- **Experimental ML Pipeline:** Local TensorFlow.js LSTM model that attempts to recognize historical price patterns.
- **Walk-Forward Backtesting Engine:** Run rigorous simulations of the ML model on historical data, accounting for realistic Indian market transaction costs (Brokerage, STT, Exchange charges, Slippage).
- **Technical Indicators:** RSI, MACD, Bollinger Bands, and Moving Averages calculated on the fly.
- **Paper Trading Simulator:** Test strategies without risking real money.

## Architecture

- **Backend:** Node.js, Express, SQLite3 (Historical data & prices cache).
- **Frontend:** React, Vite, Recharts, WebSocket client.

*(Note: An earlier experimental Rust backend was deprecated to centralize and validate the Node.js ML pipeline.)*

## Security Note
**Broker Credentials:** Do NOT expose your Angel One or other broker credentials. The system previously included a REST endpoint to update `.env` passwords—this has been permanently removed for security. All broker credentials must be entered manually into your secure local `.env` file and should never be committed to version control.

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Iitian001/BHARAT-SCREENER.git
   cd BHARAT-SCREENER
   ```

2. **Setup Backend:**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your broker credentials if needed
   node src/index.js
   ```

3. **Setup Frontend:**
   Open a new terminal window:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. **Running the Backtester:**
   You can run a walk-forward backtest for any symbol from the command line:
   ```bash
   cd backend
   node src/ml/backtester.js RELIANCE
   ```
