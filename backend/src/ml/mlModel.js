/**
 * Experimental Pattern Matcher (Toy LSTM)
 * 
 * DISCLAIMER: This is a 2-layer LSTM model trained on a small amount of historical data. 
 * It is NOT a production-ready "Deep Learning Pipeline". It is a toy regression model 
 * meant for educational paper-trading purposes. It has NO statistical power to predict 
 * short-term price movements and does NOT constitute financial advice.
 */

const tf = require('@tensorflow/tfjs');
const TechnicalIndicators = require('./technicalIndicators');

class StockPredictionModel {
  constructor() {
    this.models = new Map(); // Cache models per symbol
    this.predictionHistory = [];
    this.isTraining = new Map();
  }

  /**
   * Normalize multi-variate data to [0, 1] range for neural network
   */
  normalizeDataMulti(dataArray) {
    const numFeatures = dataArray[0].length;
    const mins = new Array(numFeatures).fill(Infinity);
    const maxs = new Array(numFeatures).fill(-Infinity);
    
    dataArray.forEach(row => {
      row.forEach((val, j) => {
        if (val < mins[j]) mins[j] = val;
        if (val > maxs[j]) maxs[j] = val;
      });
    });

    const normalized = dataArray.map(row => {
      return row.map((val, j) => {
        if (maxs[j] === mins[j]) return 0;
        return (val - mins[j]) / (maxs[j] - mins[j]);
      });
    });

    return { normalized, mins, maxs };
  }

  /**
   * Create windows for multi-variate time-series forecasting
   */
  createWindowsMulti(data, windowSize, targetIndex = 3) {
    const X = [];
    const y = [];
    for (let i = 0; i <= data.length - windowSize - 1; i++) {
      X.push(data.slice(i, i + windowSize));
      y.push(data[i + windowSize][targetIndex]);
    }
    return { X, y };
  }

  /**
   * Train an LSTM model for a specific symbol
   */
  async trainModelForSymbol(symbol, historicalData) {
    if (this.isTraining.get(symbol)) return;
    this.isTraining.set(symbol, true);

    try {
      console.log(`[TFJS] Building and training Pattern Matcher for ${symbol}...`);
      
      // Features: [Open, High, Low, Close, Volume]
      const features = historicalData.map(d => [d.open, d.high, d.low, d.close, d.volume || 0]);
      const { normalized, mins, maxs } = this.normalizeDataMulti(features);
      const numFeatures = features[0].length;
      
      const windowSize = 20; // Look back 20 days
      const { X, y } = this.createWindowsMulti(normalized, windowSize, 3); // 3 is Close
      
      if (X.length === 0) {
        throw new Error('Not enough data to train model');
      }

      // Convert to tensors
      const tensorX = tf.tensor3d(X, [X.length, windowSize, numFeatures]);
      const tensorY = tf.tensor2d(y, [y.length, 1]);

      // Build Toy LSTM Model
      const model = tf.sequential();
      model.add(tf.layers.lstm({
        units: 32, // Reduced from 64 to prevent CPU hang
        inputShape: [windowSize, numFeatures],
        returnSequences: true
      }));
      model.add(tf.layers.dropout({ rate: 0.2 }));
      model.add(tf.layers.lstm({
        units: 16, // Reduced from 32
        returnSequences: false
      }));
      model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
      model.add(tf.layers.dense({ units: 1, activation: 'linear' }));

      model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'meanSquaredError'
      });

      // Train
      await model.fit(tensorX, tensorY, {
        epochs: 15, // Reduced from 25 for real-time responsiveness
        batchSize: 32,
        shuffle: true,
        validationSplit: 0.2, // Held-out 20% validation split to monitor real accuracy
        verbose: 0
      });

      // FREE MEMORY TO PREVENT SERVER CRASHES
      tensorX.dispose();
      tensorY.dispose();

      // Save to cache
      this.models.set(symbol, {
        model,
        mins,
        maxs,
        numFeatures,
        windowSize,
        lastTrained: Date.now()
      });

      console.log(`[TFJS] Multi-Variate Model for ${symbol} successfully trained!`);
    } catch (error) {
      console.error(`[TFJS] Training error for ${symbol}:`, error);
    } finally {
      this.isTraining.set(symbol, false);
    }
  }

  /**
   * Analyze stock and generate prediction
   */
  async predictAsync(args) {
    const { historicalData, currentData, symbol, modelType = 'ensemble', params = { conf: 65, returnThresh: 1.5 }, xgbAction: historicalXgbAction } = args;
    
    if (!historicalData || historicalData.length < 50) {
      return { success: false, error: 'Insufficient historical data (need at least 50 candles)', action: 'HOLD', symbol };
    }

    const currentPrice = currentData.price || historicalData[historicalData.length - 1].close;
    const indicators = TechnicalIndicators.calculateAll(historicalData);
    const technicalSignal = TechnicalIndicators.generateSignal(indicators, currentPrice);

    // ML Pipeline
    let dlPredictedPrice = null;
    let confidence = technicalSignal.confidence;
    let action = technicalSignal.signal;
    let targetPrice = currentPrice;
    let stopLoss = currentPrice;

    // Check if we have a trained model
    const cachedModel = this.models.get(symbol);
    
    // Asynchronously trigger training if needed
    if (!cachedModel || (Date.now() - cachedModel.lastTrained > 24 * 60 * 60 * 1000)) {
      // Don't await training, let it run in background so we don't block the request for too long
      this.trainModelForSymbol(symbol, historicalData).catch(console.error);
    }

    if (cachedModel) {
      // Run inference
      const features = historicalData.map(d => [d.open, d.high, d.low, d.close, d.volume || 0]);
      const recentFeatures = features.slice(-cachedModel.windowSize);
      
      // Normalize input
      const normalizedInput = recentFeatures.map(row => {
        return row.map((val, j) => {
          if (cachedModel.maxs[j] === cachedModel.mins[j]) return 0;
          return (val - cachedModel.mins[j]) / (cachedModel.maxs[j] - cachedModel.mins[j]);
        });
      });
      
      const tensorInput = tf.tensor3d([normalizedInput], [1, cachedModel.windowSize, cachedModel.numFeatures]);
      const tensorOutput = cachedModel.model.predict(tensorInput);
      const normalizedPred = tensorOutput.dataSync()[0];
      
      // Denormalize target index (3 = close)
      const targetMin = cachedModel.mins[3];
      const targetMax = cachedModel.maxs[3];
      dlPredictedPrice = normalizedPred * (targetMax - targetMin) + targetMin;
      
      // Free memory
      tensorInput.dispose();
      tensorOutput.dispose();

      // Combine AI Insight with Technicals
      const predictedChange = ((dlPredictedPrice - currentPrice) / currentPrice) * 100;
      
      if (predictedChange > params.returnThresh) {
        action = technicalSignal.signal === 'BUY' ? 'BUY' : 'HOLD'; // Require consensus
        confidence = Math.min(confidence + 15, 95);
        targetPrice = dlPredictedPrice;
        stopLoss = currentPrice - (dlPredictedPrice - currentPrice) * 0.5; // 1:2 R:R
      } else if (predictedChange < -params.returnThresh) {
        action = technicalSignal.signal === 'SELL' ? 'SELL' : 'HOLD';
        confidence = Math.min(confidence + 15, 95);
        targetPrice = dlPredictedPrice;
        stopLoss = currentPrice + (currentPrice - dlPredictedPrice) * 0.5;
      } else {
        action = 'HOLD';
        confidence = Math.max(confidence - 10, 30);
      }
    } else {
      // Fallback while training
      targetPrice = technicalSignal.signal === 'BUY' ? currentPrice * 1.05 : currentPrice * 0.95;
      stopLoss = technicalSignal.signal === 'BUY' ? currentPrice * 0.97 : currentPrice * 1.03;
    }

    const riskPercent = Math.abs((currentPrice - stopLoss) / currentPrice) * 100;
    const rewardPercent = Math.abs((targetPrice - currentPrice) / currentPrice) * 100;
    const riskRewardRatio = riskPercent > 0 ? (rewardPercent / riskPercent).toFixed(2) : 0;

    // --- PHASE 2: XGBOOST ENSEMBLE LOGIC ---
    let xgbProbability = null;
    let xgbAction = historicalXgbAction || null; // Use bulk prediction if passed
    
    if (modelType === 'ensemble' && !xgbAction) {
      try {
        const axios = require('axios');
        // Fetch prediction from Python XGBoost Microservice
        const xgbRes = await axios.post(`http://localhost:8000/predict/${symbol}`, {
          current_price: currentPrice,
          current_high: currentData.high || currentPrice,
          current_low: currentData.low || currentPrice
        }, { timeout: 2000 });
        
        if (xgbRes.data) {
          xgbProbability = xgbRes.data.probability_up;
          xgbAction = xgbRes.data.action;
        }
      } catch (err) {
        // Python service might be down or not trained yet. We fall back gracefully.
        // console.warn(`XGBoost prediction unavailable for ${symbol}`);
      }
    }

    // Combine models if XGBoost is available
    if (modelType === 'ensemble' && xgbAction) {
      // Require consensus!
      if (action === 'BUY' && xgbAction === 'BUY') {
        confidence = Math.min(confidence + 10, 99);
      } else if (action === 'SELL' && xgbAction === 'SELL') {
        confidence = Math.min(confidence + 10, 99);
      } else {
        // Models disagree. Force HOLD and drop confidence.
        action = 'HOLD';
        confidence = Math.max(confidence - 20, 20);
      }
    }

    let finalConfidence = Math.round(confidence);
    
    // Explicit No-Trade Zone constraint
    if (finalConfidence < params.conf) {
      action = 'HOLD';
    }

    const prediction = {
      success: true,
      symbol,
      timestamp: new Date().toISOString(),
      action,
      confidence: finalConfidence,
      currentPrice,
      targetPrice,
      stopLoss,
      riskRewardRatio,
      maxRisk: riskPercent.toFixed(2),
      // ATR-based position sizing (Risking 1% of a hypothetical ₹1,00,000 account)
      // Risk per share = 1 * ATR. Total risk = ₹1000.
      suggestedQuantity: indicators.atr14 ? Math.floor(1000 / indicators.atr14) || 1 : 1,
      positionValue: (indicators.atr14 ? Math.floor(1000 / indicators.atr14) || 1 : 1) * currentPrice,
      indicators: {
        rsi: indicators.rsi14,
        macd: indicators.macd,
        sma20: indicators.sma20,
        sma50: indicators.sma50,
        atr: indicators.atr14
      },
      signals: { technical: technicalSignal, dlPredictedPrice, xgbAction, xgbProbability },
      reasons: [
        ...technicalSignal.reasons,
        cachedModel 
          ? `LSTM model predicts price movement to ₹${dlPredictedPrice.toFixed(2)}`
          : `LSTM model is currently training in the background. Using technicals.`
      ],
      warnings: [],
      timeHorizon: '1-2 weeks'
    };

    if (xgbAction) {
      prediction.reasons.push(`XGBoost Model confirms ${xgbAction} with probability ${(xgbProbability * 100).toFixed(1)}%.`);
    }

    return prediction;
  }

  // Wrapper for synchronous compatibility with routes, but ideally route uses predictAsync
  predict(params) {
    throw new Error('Please use predictAsync for LSTM models');
  }
}

module.exports = new StockPredictionModel();
