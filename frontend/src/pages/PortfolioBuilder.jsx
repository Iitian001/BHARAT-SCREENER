import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './PortfolioBuilder.css'

const API_BASE = 'http://localhost:8080'

// Format INR
const formatINR = (val) => `₹${Number(val).toLocaleString('en-IN')}`

export default function PortfolioBuilder() {
  const navigate = useNavigate()

  // Form State
  const [budget, setBudget] = useState(100000)
  const [risk, setRisk] = useState('Medium')
  const [term, setTerm] = useState('Short')

  // API State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [portfolio, setPortfolio] = useState(null)

  // Pre-load status
  const [preloadStatus, setPreloadStatus] = useState(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/preload/status`)
        const data = await res.json()
        if (data.success) setPreloadStatus(data)
      } catch (e) { /* server not ready yet */ }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleGenerate = async () => {
    if (budget < 1000) {
      setError('Minimum budget is ₹1000')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/portfolio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: Number(budget), risk, term })
      })
      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate portfolio')
      }

      setPortfolio(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="portfolio-page fadeIn">
      <div className="detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back to Dashboard</span>
        </button>
      </div>

      <div className="portfolio-header">
        <h1>AI Robo-Advisor</h1>
        <p>Generate an optimized, diversified portfolio instantly using our Multi-Variate Deep Learning engine.</p>
      </div>

      <div className="portfolio-layout">
        {/* Left Sidebar: Form */}
        <div className="portfolio-sidebar">
          <h2>⚙️ Portfolio Settings</h2>
          
          <div className="form-group">
            <label>Total Budget (₹)</label>
            <input 
              type="number" 
              className="budget-input"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              min="1000"
              step="5000"
            />
          </div>

          <div className="form-group">
            <label>Risk Tolerance</label>
            <div className="risk-selector">
              {['Low', 'Medium', 'High'].map(r => (
                <button 
                  key={r}
                  className={`toggle-btn ${risk === r ? 'active' : ''}`}
                  onClick={() => setRisk(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Investment Horizon</label>
            <div className="term-selector">
              {['Short', 'Long'].map(t => (
                <button 
                  key={t}
                  className={`toggle-btn ${term === t ? 'active' : ''}`}
                  onClick={() => setTerm(t)}
                >
                  {t}-Term
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error-message" style={{marginBottom: '16px'}}>{error}</div>}

          {preloadStatus && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: preloadStatus.running ? 'rgba(234, 179, 8, 0.1)' : 'rgba(34, 197, 94, 0.1)',
              border: `1px solid ${preloadStatus.running ? 'rgba(234, 179, 8, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
              fontSize: '0.8rem',
              color: preloadStatus.running ? '#eab308' : '#22c55e',
              marginBottom: '12px'
            }}>
              {preloadStatus.running 
                ? `📦 Pre-loading: ${preloadStatus.succeeded.toLocaleString()} / ${preloadStatus.total.toLocaleString()} stocks cached`
                : `✅ ${preloadStatus.cachedStocks.toLocaleString()} stocks ready for full market scan`
              }
            </div>
          )}

          <button 
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? <div className="spinner"></div> : 'Generate Portfolio'}
          </button>
        </div>

        {/* Right Main: Results */}
        <div className="portfolio-main">
          {!portfolio && !loading && (
            <div className="portfolio-empty">
              <span className="icon">💼</span>
              <h3>No Portfolio Generated</h3>
              <p>Adjust your settings and click Generate to see AI suggestions.</p>
            </div>
          )}

          {loading && !portfolio && (
            <div className="portfolio-empty">
              <div className="spinner" style={{ width: '48px', height: '48px', marginBottom: '16px' }}></div>
              <h3>Scanning {preloadStatus?.cachedStocks?.toLocaleString() || 'all'} NSE Stocks...</h3>
              <p>Running technical analysis + LSTM Deep Learning</p>
            </div>
          )}

          {portfolio && !loading && (
            <>
              {/* Summary Cards */}
              <div className="portfolio-summary">
                <div className="summary-card">
                  <div className="label">Total Budget</div>
                  <div className="value">{formatINR(portfolio.budget)}</div>
                </div>
                <div className="summary-card">
                  <div className="label">Invested Amount</div>
                  <div className="value">{formatINR(portfolio.investedAmount)}</div>
                </div>
                <div className="summary-card">
                  <div className="label">Est. Profit ({term === 'Short' ? '1m' : '1y'})</div>
                  <div className="value positive">+{formatINR(portfolio.estimatedProfit)}</div>
                </div>
                <div className="summary-card">
                  <div className="label">Overall Expected Return</div>
                  <div className="value positive">+{portfolio.overallExpectedReturn}%</div>
                </div>
                {portfolio.stocksScanned && (
                  <div className="summary-card">
                    <div className="label">Stocks Scanned</div>
                    <div className="value">{portfolio.stocksScanned.toLocaleString()}</div>
                  </div>
                )}
              </div>

              {/* Stock List */}
              <div className="portfolio-stocks">
                <h3>Recommended Allocation</h3>
                <div className="stock-list">
                  {portfolio.portfolio.map(stock => (
                    <div className="stock-item" key={stock.symbol}>
                      <div className="stock-symbol">{stock.symbol}</div>
                      
                      <div className="stock-allocation">
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{stock.allocationPercent}%</span>
                        <div className="allocation-bar">
                          <div className="allocation-fill" style={{ width: `${stock.allocationPercent}%` }}></div>
                        </div>
                      </div>

                      <div className="stock-qty">
                        Qty: <span>{stock.quantity}</span> @ {formatINR(stock.buyPrice)}
                      </div>

                      <div className="stock-invested">
                        Total: <span>{formatINR(stock.totalInvestment)}</span>
                      </div>

                      <div className="stock-return">
                        +{stock.expectedReturnPercent}%
                      </div>
                    </div>
                  ))}
                </div>
                
                <div style={{ marginTop: '20px', textAlign: 'right' }}>
                  <button 
                    className="generate-btn" 
                    style={{ backgroundColor: '#22c55e', color: '#fff', fontSize: '1.1rem', padding: '12px 24px', width: 'auto' }}
                    onClick={async () => {
                      if (!window.confirm(`Are you sure you want to execute trades for ₹${portfolio.investedAmount.toLocaleString('en-IN')}?`)) return;
                      
                      try {
                        for (const stock of portfolio.portfolio) {
                          await fetch('http://localhost:8080/api/holdings/buy', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              symbol: stock.symbol,
                              quantity: stock.quantity,
                              buy_price: stock.buyPrice,
                              target_price: stock.buyPrice * (1 + (stock.expectedReturnPercent / 100)),
                              stop_loss: stock.buyPrice * 0.95, // 5% trailing stop loss initial
                              strategy_reason: `AI ${risk} Risk / ${term} Term Portfolio Generation`
                            })
                          });
                        }
                        alert('Portfolio completely executed! Check your Holdings tab.');
                        navigate('/holdings');
                      } catch (e) {
                        alert('Error executing portfolio: ' + e.message);
                      }
                    }}
                  >
                    🚀 EXECUTE PORTFOLIO
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
