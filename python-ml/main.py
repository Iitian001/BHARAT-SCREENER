import sqlite3
import pandas as pd
import numpy as np
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import joblib

app = FastAPI(title="Bharat Screener - XGBoost Microservice")

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "stocks.db")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

os.makedirs(MODELS_DIR, exist_ok=True)

# Helper to fetch data
def fetch_data(symbol: str):
    conn = sqlite3.connect(DB_PATH)
    query = f"SELECT * FROM price_history WHERE symbol = '{symbol}' ORDER BY timestamp ASC"
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df

# Feature Engineering
def create_features(df, symbol):
    if df.empty or len(df) < 50:
        return df

    # Returns
    df['ret_1d'] = df['close'].pct_change(1)
    df['ret_5d'] = df['close'].pct_change(5)
    df['ret_10d'] = df['close'].pct_change(10)
    
    # Volatility
    df['vol_10d'] = df['ret_1d'].rolling(10).std()
    
    # Simple Moving Averages
    df['sma_20'] = df['close'].rolling(20).mean()
    df['sma_50'] = df['close'].rolling(50).mean()
    df['dist_sma_20'] = (df['close'] - df['sma_20']) / df['sma_20']
    
    # High-Low Range
    df['range'] = (df['high'] - df['low']) / df['close']

    # Target: 5-day forward return
    df['target'] = df['close'].shift(-5) / df['close'] - 1
    
    # Fundamental Features
    conn = sqlite3.connect(DB_PATH)
    fund_query = f"SELECT trailing_pe, price_to_book, return_on_equity, debt_to_equity FROM fundamentals WHERE symbol = '{symbol}'"
    fund_df = pd.read_sql_query(fund_query, conn)
    conn.close()

    if not fund_df.empty:
        df['pe_ratio'] = fund_df.iloc[0]['trailing_pe']
        df['pb_ratio'] = fund_df.iloc[0]['price_to_book']
        df['roe'] = fund_df.iloc[0]['return_on_equity']
        df['debt_eq'] = fund_df.iloc[0]['debt_to_equity']
    else:
        df['pe_ratio'] = np.nan
        df['pb_ratio'] = np.nan
        df['roe'] = np.nan
        df['debt_eq'] = np.nan

    # Fill NaNs for fundamentals with cross-sectional proxy (here we just use 0 or median, for simplicity 0)
    df[['pe_ratio', 'pb_ratio', 'roe', 'debt_eq']] = df[['pe_ratio', 'pb_ratio', 'roe', 'debt_eq']].fillna(0)

    # Drop NaNs from rolling windows
    df.dropna(subset=['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'sma_20', 'sma_50', 'dist_sma_20', 'range', 'target'], inplace=True)
    return df

@app.post("/train/{symbol}")
def train_model(symbol: str):
    df = fetch_data(symbol)
    if len(df) < 100:
        raise HTTPException(status_code=400, detail="Not enough historical data to train")

    df = create_features(df, symbol)
    
    features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
    X = df[features]
    
    # Binary classification: Will the stock go up more than 1% in the next 5 days?
    y = (df['target'] > 0.01).astype(int)
    
    # Time series split (last 20% for validation)
    split_idx = int(len(X) * 0.8)
    X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]
    
    model = xgb.XGBClassifier(
        n_estimators=100, 
        max_depth=3, 
        learning_rate=0.05, 
        early_stopping_rounds=10,
        eval_metric='logloss'
    )
    
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    
    model_path = os.path.join(MODELS_DIR, f"{symbol}_xgb.pkl")
    joblib.dump(model, model_path)
    
    return {"message": f"Successfully trained XGBoost for {symbol}"}


class PredictRequest(BaseModel):
    current_price: float
    current_high: float
    current_low: float


@app.post("/predict/{symbol}")
def predict(symbol: str, req: PredictRequest):
    model_path = os.path.join(MODELS_DIR, f"{symbol}_xgb.pkl")
    if not os.path.exists(model_path):
        # Trigger train if missing
        train_model(symbol)
        if not os.path.exists(model_path):
            raise HTTPException(status_code=500, detail="Failed to create model")

    model = joblib.load(model_path)
    
    # Fetch recent history to compute features for the current day
    df = fetch_data(symbol)
    if df.empty:
        raise HTTPException(status_code=400, detail="No historical data")
    
    # Append current day pseudo-tick to create latest features
    latest_ts = pd.to_datetime('now')
    new_row = pd.DataFrame([{
        'symbol': symbol,
        'timestamp': latest_ts,
        'open': df.iloc[-1]['close'], # proxy
        'high': req.current_high,
        'low': req.current_low,
        'close': req.current_price,
        'volume': 0
    }])
    
    df = pd.concat([df, new_row], ignore_index=True)
    df = create_features(df, symbol)
    
    if df.empty:
        raise HTTPException(status_code=400, detail="Insufficient data for feature engineering")
    
    features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
    X_latest = df.iloc[-1:][features]
    
    prob_up = float(model.predict_proba(X_latest)[0][1])
    
    action = "HOLD"
    if prob_up > 0.65:
        action = "BUY"
    elif prob_up < 0.35:
        action = "SELL"
        
    return {
        "symbol": symbol,
        "action": action,
        "confidence": int(max(prob_up, 1 - prob_up) * 100),
        "probability_up": prob_up
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
