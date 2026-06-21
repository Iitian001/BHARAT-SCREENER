import React, { useState, useMemo } from 'react'

/**
 * PredictionPanel — ML Prediction Display
 * - BUY/SELL/HOLD badge with glow effect
 * - Confidence meter (circular progress)
 * - Price ladder: Current → Target → Stop Loss
 * - Suggested Quantity + Position Value
 * - Capital input (default ₹1,00,000)
 * - Technical indicators: RSI, MACD, Bollinger
 * - Reasons + Warnings lists
 * - Disclaimer footer
 */

// Format ₹ in Indian number system
const formatINR = (value) => {
  if (!value && value !== 0) return '—'
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PredictionPanel({ prediction, isLoading, currentPrice, backtestData }) {
  const [capital, setCapital] = useState(100000)

  // Derived calculations
  const computed = useMemo(() => {
    if (!prediction) return null

    const action = (prediction.action || prediction.signal || 'HOLD').toUpperCase()
    const confidence = prediction.confidence || prediction.probability || 0
    const target = prediction.target || prediction.targetPrice || 0
    const stopLoss = prediction.stopLoss || prediction.stop_loss || 0
    const price = currentPrice || prediction.currentPrice || prediction.price || 0
    const quantity = prediction.quantity || (price > 0 ? Math.floor(capital / price) : 0)
    const positionValue = quantity * price
    const potentialProfit = target > 0 ? (target - price) * quantity : 0
    const potentialLoss = stopLoss > 0 ? (price - stopLoss) * quantity : 0
    const riskReward = potentialLoss > 0 ? (potentialProfit / potentialLoss).toFixed(2) : '—'
    const targetPercent = price > 0 && target > 0 ? (((target - price) / price) * 100).toFixed(2) : 0
    const stopLossPercent = price > 0 && stopLoss > 0 ? (((price - stopLoss) / price) * 100).toFixed(2) : 0

    return {
      action,
      confidence: Math.round(confidence * (confidence <= 1 ? 100 : 1)),
      target,
      stopLoss,
      price,
      quantity,
      positionValue,
      potentialProfit,
      potentialLoss,
      riskReward,
      targetPercent,
      stopLossPercent,
      reasons: prediction.reasons || prediction.analysis?.reasons || [],
      warnings: prediction.warnings || prediction.analysis?.warnings || [],
      indicators: prediction.indicators || prediction.technicals || {},
      timeHorizon: prediction.timeHorizon || prediction.horizon || 'Short Term',
    }
  }, [prediction, capital, currentPrice])

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="prediction-panel">
        <div className="prediction-panel-header">
          <h3>🤖 AI Prediction</h3>
        </div>
        <div className="prediction-loading">
          <div className="loading-skeleton skeleton-badge"></div>
          <div className="loading-skeleton skeleton-meter"></div>
          <div className="loading-skeleton skeleton-line"></div>
          <div className="loading-skeleton skeleton-line short"></div>
          <div className="loading-skeleton skeleton-line"></div>
          <div className="loading-skeleton skeleton-line short"></div>
        </div>
      </div>
    )
  }

  // No prediction available
  if (!prediction || !computed) {
    return (
      <div className="prediction-panel">
        <div className="prediction-panel-header">
          <h3>🤖 AI Prediction</h3>
        </div>
        <div className="prediction-empty">
          <span className="prediction-empty-icon">🔮</span>
          <p>Analyzing stock data...</p>
          <p className="prediction-empty-hint">Prediction will appear once analysis completes</p>
        </div>
      </div>
    )
  }

  // Signal color mapping
  const signalColors = {
    BUY: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', glow: '0 0 30px rgba(34, 197, 94, 0.4)' },
    SELL: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', glow: '0 0 30px rgba(239, 68, 68, 0.4)' },
    HOLD: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', glow: '0 0 30px rgba(245, 158, 11, 0.4)' },
    'STRONG BUY': { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.2)', glow: '0 0 40px rgba(34, 197, 94, 0.5)' },
    'STRONG SELL': { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', glow: '0 0 40px rgba(239, 68, 68, 0.5)' },
  }

  const signal = signalColors[computed.action] || signalColors.HOLD

  // RSI gauge level
  const getRSIStatus = (rsi) => {
    if (!rsi) return { label: 'N/A', color: '#888' }
    if (rsi > 70) return { label: 'Overbought', color: '#ef4444' }
    if (rsi > 60) return { label: 'Bullish', color: '#22c55e' }
    if (rsi < 30) return { label: 'Oversold', color: '#ef4444' }
    if (rsi < 40) return { label: 'Bearish', color: '#f59e0b' }
    return { label: 'Neutral', color: '#888' }
  }

  const rsiValue = computed.indicators.rsi || computed.indicators.RSI
  const rsiStatus = getRSIStatus(rsiValue)

  return (
    <div className="prediction-panel">
      {/* Panel Header */}
      <div className="prediction-panel-header">
        <h3>🤖 AI Prediction</h3>
        <span className="prediction-horizon">{computed.timeHorizon}</span>
      </div>

      {/* Signal Badge */}
      <div className="signal-section">
        <div
          className={`signal-badge signal-${computed.action.toLowerCase().replace(' ', '-')}`}
          style={{ backgroundColor: signal.bg, color: signal.color, boxShadow: signal.glow }}
        >
          <span className="signal-icon">
            {computed.action.includes('BUY') ? '▲' : computed.action.includes('SELL') ? '▼' : '●'}
          </span>
          <span className="signal-text">{computed.action}</span>
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="confidence-section">
        <div className="confidence-label">Confidence</div>
        <div className="confidence-meter">
          <div className="confidence-bar-track">
            <div
              className="confidence-bar-fill"
              style={{
                width: `${computed.confidence}%`,
                background: computed.confidence > 70
                  ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                  : computed.confidence > 40
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                    : 'linear-gradient(90deg, #ef4444, #f87171)',
              }}
            ></div>
          </div>
          <span className="confidence-value">{computed.confidence}%</span>
        </div>
      </div>

      {/* Backtest Metrics */}
      {backtestData && (
        <div className="backtest-section" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', borderLeft: '4px solid #8b5cf6' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#a78bfa', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Historical Edge (Backtest)</h4>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Win Rate</span>
              <span style={{ color: backtestData.winRatePct > 50 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>{backtestData.winRatePct}%</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>Sharpe Ratio</span>
              <span style={{ color: backtestData.sharpeRatio > 1 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>{backtestData.sharpeRatio}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
              <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>vs NIFTY</span>
              <span style={{ color: (parseFloat(backtestData.totalReturnPct) - parseFloat(backtestData.benchmarkReturnPct)) > 0 ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                {((parseFloat(backtestData.totalReturnPct) - parseFloat(backtestData.benchmarkReturnPct)) > 0 ? '+' : '')}{(parseFloat(backtestData.totalReturnPct) - parseFloat(backtestData.benchmarkReturnPct)).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Price Ladder */}
      <div className="price-ladder">
        <div className="price-ladder-item target">
          <span className="price-ladder-label">🎯 Target</span>
          <span className="price-ladder-value">{formatINR(computed.target)}</span>
          {computed.targetPercent > 0 && (
            <span className="price-ladder-percent positive">+{computed.targetPercent}%</span>
          )}
        </div>
        <div className="price-ladder-connector">
          <div className="price-ladder-line"></div>
        </div>
        <div className="price-ladder-item current">
          <span className="price-ladder-label">📍 Current</span>
          <span className="price-ladder-value">{formatINR(computed.price)}</span>
        </div>
        <div className="price-ladder-connector">
          <div className="price-ladder-line red"></div>
        </div>
        <div className="price-ladder-item stoploss">
          <span className="price-ladder-label">🛑 Stop Loss</span>
          <span className="price-ladder-value">{formatINR(computed.stopLoss)}</span>
          {computed.stopLossPercent > 0 && (
            <span className="price-ladder-percent negative">-{computed.stopLossPercent}%</span>
          )}
        </div>
      </div>

      {/* Capital & Quantity Section */}
      <div className="capital-section">
        <div className="capital-input-group">
          <label className="capital-label">💰 Investment Capital</label>
          <div className="capital-input-wrapper">
            <span className="capital-prefix">₹</span>
            <input
              type="number"
              className="capital-input"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value) || 0)}
              min={0}
              step={10000}
            />
          </div>
        </div>
        <div className="quantity-grid">
          <div className="quantity-item">
            <span className="quantity-label">Quantity</span>
            <span className="quantity-value">{computed.quantity}</span>
          </div>
          <div className="quantity-item">
            <span className="quantity-label">Position Value</span>
            <span className="quantity-value">{formatINR(computed.positionValue)}</span>
          </div>
          <div className="quantity-item">
            <span className="quantity-label">Risk/Reward</span>
            <span className="quantity-value rr-value">{computed.riskReward}x</span>
          </div>
          <div className="quantity-item">
            <span className="quantity-label">Potential Profit</span>
            <span className="quantity-value positive">{formatINR(computed.potentialProfit)}</span>
          </div>
        </div>
      </div>

      {/* Technical Indicators */}
      {Object.keys(computed.indicators).length > 0 && (
        <div className="indicators-section">
          <h4 className="indicators-title">📈 Technical Indicators</h4>
          <div className="indicators-grid">
            {/* RSI */}
            {rsiValue !== undefined && (
              <div className="indicator-card">
                <span className="indicator-name">RSI (14)</span>
                <div className="indicator-gauge">
                  <div className="indicator-gauge-track">
                    <div
                      className="indicator-gauge-fill"
                      style={{ width: `${Math.min(rsiValue, 100)}%` }}
                    ></div>
                    <div className="indicator-gauge-zones">
                      <div className="zone oversold"></div>
                      <div className="zone neutral"></div>
                      <div className="zone overbought"></div>
                    </div>
                  </div>
                  <div className="indicator-gauge-info">
                    <span className="indicator-value">{Number(rsiValue).toFixed(1)}</span>
                    <span className="indicator-status" style={{ color: rsiStatus.color }}>{rsiStatus.label}</span>
                  </div>
                </div>
              </div>
            )}

            {/* MACD */}
            {computed.indicators.macd !== undefined && (
              <div className="indicator-card">
                <span className="indicator-name">MACD</span>
                <span className={`indicator-badge ${(typeof computed.indicators.macd === 'number' ? computed.indicators.macd > 0 : (computed.indicators.macd?.macd > 0 || computed.indicators.macdSignal === 'bullish')) ? 'bullish' : 'bearish'}`}>
                  {typeof computed.indicators.macd === 'number'
                    ? (computed.indicators.macd > 0 ? '↗ Bullish' : '↘ Bearish')
                    : typeof computed.indicators.macd === 'object' 
                      ? (computed.indicators.macd?.macd > 0 ? '↗ Bullish' : '↘ Bearish')
                      : (computed.indicators.macd || computed.indicators.macdSignal || '—')
                  }
                </span>
              </div>
            )}

            {/* Bollinger Bands */}
            {computed.indicators.bollingerBands !== undefined && (
              <div className="indicator-card">
                <span className="indicator-name">Bollinger Bands</span>
                <span className="indicator-badge neutral">
                  {typeof computed.indicators.bollingerBands === 'string'
                    ? computed.indicators.bollingerBands
                    : 'Active'}
                </span>
              </div>
            )}

            {/* SMA */}
            {computed.indicators.sma !== undefined && (
              <div className="indicator-card">
                <span className="indicator-name">SMA</span>
                <span className="indicator-badge neutral">
                  {typeof computed.indicators.sma === 'number'
                    ? formatINR(computed.indicators.sma)
                    : computed.indicators.sma}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reasons */}
      {computed.reasons.length > 0 && (
        <div className="reasons-section">
          <h4 className="reasons-title">
            {computed.action.includes('BUY') ? '✅' : computed.action.includes('SELL') ? '🔴' : '📋'} Reasons
          </h4>
          <ul className="reasons-list">
            {computed.reasons.map((reason, i) => (
              <li key={i} className="reason-item">{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {computed.warnings.length > 0 && (
        <div className="warnings-section">
          <h4 className="warnings-title">⚠️ Warnings</h4>
          <ul className="warnings-list">
            {computed.warnings.map((warning, i) => (
              <li key={i} className="warning-item">{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      <div className="prediction-disclaimer">
        <p>⚠️ <strong>Disclaimer:</strong> For educational purposes only. Not financial advice. 
        Always do your own research before making investment decisions. Past performance 
        does not guarantee future results.</p>
      </div>
    </div>
  )
}
