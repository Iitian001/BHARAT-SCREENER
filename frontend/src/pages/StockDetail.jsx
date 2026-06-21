import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import CandlestickChart from '../components/CandlestickChart'
import PredictionPanel from '../components/PredictionPanel'
import CompanyInfo from '../components/CompanyInfo'

const API_BASE = 'http://localhost:8080'

/**
 * StockDetail — Full stock detail page
 * Route: /stock/:symbol
 * - Header: Symbol + Name + Live Price + Change + Back button
 * - Left column (60%): Candlestick chart
 * - Right column (40%): ML Prediction panel
 * - Below: Company info (full width)
 */

// Format price in Indian Rupees
const formatPrice = (price) =>
  `₹${Number(price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function StockDetail() {
  const { symbol } = useParams()
  const navigate = useNavigate()

  // State
  const [company, setCompany] = useState(null)
  const [quote, setQuote] = useState(null)
  const [historicalData, setHistoricalData] = useState([])
  const [prediction, setPrediction] = useState(null)

  // Loading states
  const [companyLoading, setCompanyLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [predictionLoading, setPredictionLoading] = useState(true)

  // Error states
  const [companyError, setCompanyError] = useState(null)
  const [chartError, setChartError] = useState(null)
  const [predictionError, setPredictionError] = useState(null)

  const [backtestData, setBacktestData] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(true)

  // Fetch company details
  const fetchCompany = useCallback(async () => {
    setCompanyLoading(true)
    setCompanyError(null)
    try {
      const res = await fetch(`${API_BASE}/api/company/${symbol}`)
      if (!res.ok) throw new Error(`Failed to fetch company data (${res.status})`)
      const data = await res.json()
      setCompany(data.company || data)
    } catch (err) {
      console.error('Company fetch error:', err)
      setCompanyError(err.message)
    } finally {
      setCompanyLoading(false)
    }
  }, [symbol])

  // Fetch live quote
  const fetchQuote = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/company/${symbol}/quote`)
      if (!res.ok) throw new Error('Quote fetch failed')
      const data = await res.json()
      setQuote(data)
    } catch (err) {
      // Quote is optional — fall back to company data
      console.warn('Quote fetch warning:', err)
    }
  }, [symbol])

  // Trigger historical data download, then fetch it
  const fetchHistorical = useCallback(async (timeframe = '1y') => {
    setChartLoading(true)
    setChartError(null)
    try {
      // First trigger the data download
      try {
        await fetch(`${API_BASE}/api/historical/${symbol}/fetch`, { method: 'POST' })
      } catch (e) {
        // Non-critical — data may already exist
        console.warn('Historical fetch trigger:', e)
      }

      // Then fetch the historical data
      const res = await fetch(`${API_BASE}/api/historical/${symbol}?period=${timeframe}`)
      if (!res.ok) throw new Error(`Failed to fetch historical data (${res.status})`)
      const data = await res.json()

      // Handle different response formats
      const candles = data.data || data.candles || data.historical || data || []
      setHistoricalData(Array.isArray(candles) ? candles : [])
    } catch (err) {
      console.error('Historical fetch error:', err)
      setChartError(err.message)
      setHistoricalData([])
    } finally {
      setChartLoading(false)
    }
  }, [symbol])

  // Run ML prediction
  const fetchPrediction = useCallback(async () => {
    setPredictionLoading(true)
    setPredictionError(null)
    try {
      const res = await fetch(`${API_BASE}/api/prediction/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      })
      if (!res.ok) throw new Error(`Prediction failed (${res.status})`)
      const data = await res.json()
      setPrediction(data)
    } catch (err) {
      console.error('Prediction error:', err)
      setPredictionError(err.message)
    } finally {
      setPredictionLoading(false)
    }
  }, [symbol])

  const fetchBacktest = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/prediction/backtest/${symbol}`)
      if (!res.ok) throw new Error('Backtest fetch failed')
      const json = await res.json()
      if (json.success && json.data) {
        setBacktestData(json.data)
      }
    } catch (err) {
      console.warn('Backtest fetch warning:', err)
    }
  }, [symbol])

  // Fetch all data on mount / symbol change
  useEffect(() => {
    if (!symbol) return
    fetchCompany()
    fetchQuote()
    fetchHistorical('1y')
    fetchPrediction()
    fetchBacktest()
  }, [symbol, fetchCompany, fetchQuote, fetchHistorical, fetchPrediction, fetchBacktest])

  // Handle timeframe change from chart
  const handleTimeframeChange = useCallback((tf) => {
    fetchHistorical(tf)
  }, [fetchHistorical])

  // Get current price from quote or company data
  const currentPrice = quote?.price || quote?.lastPrice || company?.price || company?.currentPrice || 0
  const priceChange = quote?.change || company?.change || 0
  const priceChangePercent = quote?.changePercent || company?.changePercent || 0
  const isPositive = priceChange >= 0
  const companyName = company?.name || company?.companyName || symbol

  return (
    <div className="stock-detail-page fadeIn">
      {/* Back Button + Header */}
      <div className="detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back</span>
        </button>

        <div className="detail-header-info">
          <div className="detail-header-left">
            <h1 className="detail-symbol">{symbol}</h1>
            <span className="detail-company-name">{companyName}</span>
            {company?.sector && (
              <span className="detail-sector-badge">{company.sector}</span>
            )}
          </div>

          <div className="detail-header-right">
            {currentPrice > 0 && (
              <>
                <div className={`detail-price ${isPositive ? 'positive' : 'negative'}`}>
                  {formatPrice(currentPrice)}
                </div>
                <div className={`detail-change ${isPositive ? 'positive' : 'negative'}`}>
                  <span>{isPositive ? '+' : ''}{priceChange.toFixed(2)}</span>
                  <span>({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)</span>
                </div>
              </>
            )}
            {currentPrice === 0 && !companyLoading && (
              <div className="detail-price-loading">
                <div className="loading-skeleton skeleton-line" style={{ width: '120px' }}></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Layout: Chart + Prediction */}
      <div className="detail-layout">
        {/* Left Column — Chart */}
        <div className="detail-left">
          {chartError ? (
            <div className="error-state">
              <span className="error-icon">📊</span>
              <p>Failed to load chart data</p>
              <p className="error-message">{chartError}</p>
              <button className="retry-button" onClick={() => fetchHistorical('1y')}>
                🔄 Retry
              </button>
            </div>
          ) : (
            <CandlestickChart
              symbol={symbol}
              data={historicalData}
              onTimeframeChange={handleTimeframeChange}
              isLoading={chartLoading}
            />
          )}
        </div>

        {/* Right Column — Prediction */}
        <div className="detail-right">
          {predictionError ? (
            <div className="error-state">
              <span className="error-icon">🤖</span>
              <p>Prediction unavailable</p>
              <p className="error-message">{predictionError}</p>
              <button className="retry-button" onClick={fetchPrediction}>
                🔄 Retry
              </button>
            </div>
          ) : (
            <PredictionPanel
              prediction={prediction}
              isLoading={predictionLoading}
              currentPrice={currentPrice}
              backtestData={backtestData}
            />
          )}
        </div>
      </div>

      {/* Company Info — Full Width */}
      <div className="detail-company-section">
        {companyError ? (
          <div className="error-state">
            <span className="error-icon">📋</span>
            <p>Failed to load company information</p>
            <p className="error-message">{companyError}</p>
            <button className="retry-button" onClick={fetchCompany}>
              🔄 Retry
            </button>
          </div>
        ) : (
          <CompanyInfo company={company} isLoading={companyLoading} />
        )}
      </div>
    </div>
  )
}
