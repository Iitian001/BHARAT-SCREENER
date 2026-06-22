import sqlite3
import pandas as pd
import numpy as np
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import joblib
from datetime import datetime
import shap

app = FastAPI(title="Bharat Screener - XGBoost Microservice")

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "stocks.db")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

os.makedirs(MODELS_DIR, exist_ok=True)

import re

def get_global_model_path() -> str:
    return os.path.join(MODELS_DIR, "global_xgb.pkl")

def fetch_all_symbols():
    conn = sqlite3.connect(DB_PATH)
    # Get up to 200 symbols to avoid excessive memory usage
    query = "SELECT DISTINCT symbol FROM price_history LIMIT 200"
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df['symbol'].tolist()

# Helper to fetch data
def fetch_data(symbol: str):
    conn = sqlite3.connect(DB_PATH)
    query = "SELECT * FROM price_history WHERE symbol = ? ORDER BY timestamp ASC"
    df = pd.read_sql_query(query, conn, params=(symbol,))
    conn.close()
    return df

def create_features(df, symbol, feature_version='v1'):
    if df.empty or len(df) < 60:
        return df

    # Base Features (v1)
    df['ret_1d'] = df['close'].pct_change(1)
    df['ret_5d'] = df['close'].pct_change(5)
    df['ret_10d'] = df['close'].pct_change(10)
    df['vol_10d'] = df['ret_1d'].rolling(10).std()
    df['sma_20'] = df['close'].rolling(20).mean()
    df['sma_50'] = df['close'].rolling(50).mean()
    df['dist_sma_20'] = (df['close'] - df['sma_20']) / df['sma_20']
    df['range'] = (df['high'] - df['low']) / df['close']

    # Target: 5-day forward return
    df['target'] = df['close'].shift(-5) / df['close'] - 1
    
    # Fundamental Features
    conn = sqlite3.connect(DB_PATH)
    fund_df = pd.read_sql_query("SELECT trailing_pe, price_to_book, return_on_equity, debt_to_equity FROM fundamentals WHERE symbol = ?", conn, params=(symbol,))
    
    if not fund_df.empty:
        df['pe_ratio'] = fund_df.iloc[0]['trailing_pe']
        df['pb_ratio'] = fund_df.iloc[0]['price_to_book']
        df['roe'] = fund_df.iloc[0]['return_on_equity']
        df['debt_eq'] = fund_df.iloc[0]['debt_to_equity']
    else:
        for c in ['pe_ratio', 'pb_ratio', 'roe', 'debt_eq']:
            df[c] = 0

    df[['pe_ratio', 'pb_ratio', 'roe', 'debt_eq']] = df[['pe_ratio', 'pb_ratio', 'roe', 'debt_eq']].fillna(0)

    base_features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']

    if feature_version == 'v2':
        # Volatility Regime
        df['vol_20d'] = df['ret_1d'].rolling(20).std()
        df['vol_regime'] = df['vol_20d'].rank(pct=True) # 20d volatility percentile

        # Advanced Volume
        df['vol_change'] = np.where(df['close'] > df['close'].shift(1), df['volume'], np.where(df['close'] < df['close'].shift(1), -df['volume'], 0))
        df['obv'] = df['vol_change'].cumsum()
        
        vol_mean = df['volume'].rolling(20).mean()
        vol_std = df['volume'].rolling(20).std()
        df['vol_zscore'] = np.where(vol_std > 0, (df['volume'] - vol_mean) / vol_std, 0)

        # Market Context & Relative Strength
        nifty = pd.read_sql_query("SELECT timestamp, close as n_close FROM indices_history WHERE symbol = 'NIFTY50'", conn)
        vix = pd.read_sql_query("SELECT timestamp, close as v_close FROM indices_history WHERE symbol = 'INDIAVIX'", conn)
        
        if not nifty.empty and not vix.empty:
            # Format timestamp for merging
            df['date_only'] = pd.to_datetime(df['timestamp']).dt.date
            nifty['date_only'] = pd.to_datetime(nifty['timestamp']).dt.date
            vix['date_only'] = pd.to_datetime(vix['timestamp']).dt.date

            nifty['n_ret_5d'] = nifty['n_close'].pct_change(5)
            nifty['n_ret_20d'] = nifty['n_close'].pct_change(20)
            nifty['n_ret_60d'] = nifty['n_close'].pct_change(60)
            nifty['n_sma_20'] = nifty['n_close'].rolling(20).mean()
            nifty['n_trend'] = (nifty['n_close'] - nifty['n_sma_20']) / nifty['n_sma_20']

            df = pd.merge(df, nifty[['date_only', 'n_trend', 'n_ret_5d', 'n_ret_20d', 'n_ret_60d']], on='date_only', how='left')
            df = pd.merge(df, vix[['date_only', 'v_close']], on='date_only', how='left')

            # Relative Strength
            df['ret_20d'] = df['close'].pct_change(20)
            df['ret_60d'] = df['close'].pct_change(60)
            df['rs_5d'] = df['ret_5d'] - df['n_ret_5d']
            df['rs_20d'] = df['ret_20d'] - df['n_ret_20d']
            df['rs_60d'] = df['ret_60d'] - df['n_ret_60d']

            # Forward fill market data if missing
            market_cols = ['n_trend', 'v_close', 'rs_5d', 'rs_20d', 'rs_60d']
            df[market_cols] = df[market_cols].ffill().fillna(0)
            
            df.drop(columns=['date_only'], inplace=True)
        else:
            df['vol_regime'] = 0
            df['obv'] = 0
            df['vol_zscore'] = 0
            df['n_trend'] = 0
            df['v_close'] = 0
            df['rs_5d'] = 0
            df['rs_20d'] = 0
            df['rs_60d'] = 0

        v2_features = ['vol_regime', 'vol_zscore', 'n_trend', 'v_close', 'rs_5d', 'rs_20d', 'rs_60d']
        base_features.extend(v2_features)

    conn.close()
    
    # Store used features list for the model
    df.attrs['feature_cols'] = base_features

    # Drop NaNs
    df.dropna(subset=base_features + ['target'], inplace=True)
    return df

@app.post("/train_global")
def train_global_model(feature_version: str = 'v2'):
    symbols = fetch_all_symbols()
    dfs = []
    
    # Fetch data and create features for all symbols
    for sym in symbols:
        try:
            df = fetch_data(sym)
            if len(df) >= 100:
                df = create_features(df, sym, feature_version)
                if not df.empty:
                    dfs.append(df)
        except Exception as e:
            print(f"Error processing {sym}: {e}")
            
    if not dfs:
        raise HTTPException(status_code=400, detail="Not enough data to train global model")
        
    master_df = pd.concat(dfs, ignore_index=True)
    master_df['timestamp_dt'] = pd.to_datetime(master_df['timestamp'])
    master_df.sort_values('timestamp_dt', inplace=True)
    master_df.drop(columns=['timestamp_dt'], inplace=True)
    
    features = None
    for df in dfs:
        if 'feature_cols' in df.attrs:
            features = df.attrs['feature_cols']
            break
            
    if not features:
        features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
        
    X = master_df[features]
    y = (master_df['target'] > 0.01).astype(int)
    
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
    
    model_path = get_global_model_path()
    joblib.dump({'model': model, 'feature_version': feature_version, 'features': features}, model_path)
    
    return {"message": f"Successfully trained global XGBoost model using {feature_version}"}


class PredictRequest(BaseModel):
    current_price: float
    current_high: float
    current_low: float


@app.post("/predict/{symbol}")
def predict(symbol: str, req: PredictRequest):
    model_path = get_global_model_path()
    if not os.path.exists(model_path):
        # Trigger train if missing
        train_global_model()
        
    if not os.path.exists(model_path):
        raise HTTPException(status_code=500, detail="Model could not be trained")
        
    loaded = joblib.load(model_path)
    if isinstance(loaded, dict) and 'model' in loaded:
        model = loaded['model']
        feature_version = loaded.get('feature_version', 'v1')
        features = loaded.get('features', ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq'])
    else:
        model = loaded
        feature_version = 'v1'
        features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
    
    df = fetch_data(symbol)
    if df.empty:
        raise HTTPException(status_code=404, detail="No historical data found")
        
    # Append current data as latest row to calculate features
    new_row = pd.DataFrame([{
        'timestamp': datetime.now().isoformat(),
        'symbol': symbol,
        'open': req.current_price, # rough approx
        'high': req.current_high,
        'low': req.current_low,
        'close': req.current_price,
        'volume': 0
    }])
    
    df = pd.concat([df, new_row], ignore_index=True)
    df = create_features(df, symbol, feature_version)
    
    if df.empty:
        raise HTTPException(status_code=400, detail="Insufficient data for feature engineering")
    
    X_latest = df.iloc[-1:][features]
    
    prob_up = float(model.predict_proba(X_latest)[0][1])
    
    # 0.65 threshold for BUY, < 0.35 for SELL, else HOLD
    action = "HOLD"
    if prob_up > 0.65:
        action = "BUY"
    elif prob_up < 0.35:
        action = "SELL"
        
    return {
        "symbol": symbol,
        "probability_up": prob_up,
        "action": action
    }

@app.get("/historical_predict/{symbol}")
def historical_predict(symbol: str):
    """
    Bulk prediction for walk-forward backtesting.
    Returns the XGBoost signals for all historical dates for a symbol.
    """
    model_path = get_global_model_path()
    if not os.path.exists(model_path):
        train_global_model()
        
    if not os.path.exists(model_path):
        raise HTTPException(status_code=500, detail="Model could not be trained")
        
    loaded = joblib.load(model_path)
    if isinstance(loaded, dict) and 'model' in loaded:
        model = loaded['model']
        feature_version = loaded.get('feature_version', 'v1')
        features = loaded.get('features', ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq'])
    else:
        model = loaded
        feature_version = 'v1'
        features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
    
    df = fetch_data(symbol)
    if df.empty:
        raise HTTPException(status_code=404, detail="No historical data found")
        
    df = create_features(df, symbol, feature_version)
    if df.empty:
        raise HTTPException(status_code=400, detail="Insufficient data")
        
    X = df[features]
    
    probs = model.predict_proba(X)[:, 1]
    
    results = {}
    for (idx, row), prob_up in zip(df.iterrows(), probs):
        date_str = str(row['timestamp'])
        prob_up = float(prob_up)
        
        action = "HOLD"
        if prob_up > 0.65:
            action = "BUY"
        elif prob_up < 0.35:
            action = "SELL"
            
        results[date_str] = {
            "probability_up": prob_up,
            "action": action
        }
        
    return results

@app.get("/explain/{symbol}")
def explain(symbol: str):
    model_path = get_global_model_path()
    if not os.path.exists(model_path):
        train_global_model()
        
    if not os.path.exists(model_path):
        raise HTTPException(status_code=500, detail="Model could not be trained")
        
    loaded = joblib.load(model_path)
    if isinstance(loaded, dict) and 'model' in loaded:
        model = loaded['model']
        feature_version = loaded.get('feature_version', 'v2')
        features = loaded.get('features', [])
    else:
        model = loaded
        feature_version = 'v2'
        features = []
        
    if not features:
        features = ['ret_1d', 'ret_5d', 'ret_10d', 'vol_10d', 'dist_sma_20', 'range', 'pe_ratio', 'pb_ratio', 'roe', 'debt_eq']
        
    df = fetch_data(symbol)
    if df.empty:
        raise HTTPException(status_code=404, detail="No historical data found")
        
    df = create_features(df, symbol, feature_version)
    if df.empty:
        raise HTTPException(status_code=400, detail="Insufficient data for feature engineering")
        
    X_latest = df.iloc[-1:][features]
    
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_latest)
    
    if isinstance(shap_values, list):
        sv = shap_values[1][0] if len(shap_values) > 1 else shap_values[0][0]
    else:
        # Array shape: (n_samples, n_features) or (n_samples, n_features, n_classes)
        if len(shap_values.shape) == 3:
            sv = shap_values[0, :, 1]
        else:
            sv = shap_values[0]
            
    # Get top 5 features
    feature_importance = pd.DataFrame({
        'feature': features,
        'contribution': sv
    })
    
    feature_importance['abs_contribution'] = feature_importance['contribution'].abs()
    top_features = feature_importance.sort_values(by='abs_contribution', ascending=False).head(5)
    
    result = []
    for _, row in top_features.iterrows():
        result.append({
            "feature": row['feature'],
            "contribution": float(row['contribution'])
        })
        
    return {
        "symbol": symbol,
        "explanations": result
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
