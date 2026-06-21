import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart } from 'lightweight-charts'

/**
 * CandlestickChart — Professional candlestick chart with volume histogram
 * - Uses lightweight-charts library (TradingView)
 * - Timeframe selector: 1D, 1W, 1M, 3M, 1Y, 5Y, MAX
 * - Volume histogram below candlesticks
 * - Dark theme matching the app
 * - Auto-resize on window resize
 */

const TIMEFRAMES = [
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
  { label: '1M', value: '1m' },
  { label: '3M', value: '3m' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
  { label: 'MAX', value: 'max' },
]

export default function CandlestickChart({ symbol, data, onTimeframeChange, isLoading }) {
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const candlestickSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const [activeTimeframe, setActiveTimeframe] = useState('1y')

  // Handle timeframe change
  const handleTimeframeChange = useCallback((tf) => {
    setActiveTimeframe(tf)
    if (onTimeframeChange) {
      onTimeframeChange(tf)
    }
  }, [onTimeframeChange])

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#888',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: 'rgba(255, 153, 51, 0.4)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#FF9933',
        },
        horzLine: {
          color: 'rgba(255, 153, 51, 0.4)',
          width: 1,
          style: 2,
          labelBackgroundColor: '#FF9933',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    })

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    })

    // Add volume series as histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })

    // Configure volume price scale
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      drawTicks: false,
    })

    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries

    // Auto-resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    // Use ResizeObserver for more reliable resizing
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(chartContainerRef.current)
    window.addEventListener('resize', handleResize)

    // Initial size
    handleResize()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // Update chart data when data prop changes
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || !data || data.length === 0) return

    // Prepare candlestick data — ensure proper formatting and remove duplicates
    const candleMap = new Map()
    data
      .filter(d => (d.time || d.timestamp || d.date) && d.open && d.high && d.low && d.close)
      .forEach(d => {
        const dateObj = new Date(d.time || d.timestamp || d.date)
        if (isNaN(dateObj.getTime())) return; // Skip invalid dates
        const timeStr = dateObj.toISOString().split('T')[0]
        // Keep the latest entry for a given day if duplicates exist
        candleMap.set(timeStr, {
          time: timeStr,
          open: Number(d.open),
          high: Number(d.high),
          low: Number(d.low),
          close: Number(d.close),
        })
      })

    const candleData = Array.from(candleMap.values()).sort((a, b) => a.time.localeCompare(b.time))

    // Prepare volume data with color based on candle direction and remove duplicates
    const volumeMap = new Map()
    data
      .filter(d => (d.time || d.timestamp || d.date) && d.volume !== undefined)
      .forEach(d => {
        const dateObj = new Date(d.time || d.timestamp || d.date)
        if (isNaN(dateObj.getTime())) return; // Skip invalid dates
        const timeStr = dateObj.toISOString().split('T')[0]
        volumeMap.set(timeStr, {
          time: timeStr,
          value: Number(d.volume),
          color: Number(d.close) >= Number(d.open)
            ? 'rgba(34, 197, 94, 0.35)'
            : 'rgba(239, 68, 68, 0.35)',
        })
      })

    const volumeData = Array.from(volumeMap.values()).sort((a, b) => a.time.localeCompare(b.time))

    try {
      candlestickSeriesRef.current.setData(candleData)
      volumeSeriesRef.current.setData(volumeData)

      // Fit content to view
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent()
      }
    } catch (err) {
      console.error('Chart data error:', err)
    }
  }, [data])

  return (
    <div className="candlestick-chart-wrapper">
      {/* Timeframe Selector */}
      <div className="timeframe-selector">
        <span className="timeframe-label">{symbol || 'Chart'}</span>
        <div className="timeframe-buttons">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`timeframe-btn ${activeTimeframe === tf.value ? 'active' : ''}`}
              onClick={() => handleTimeframeChange(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Area */}
      <div className="candlestick-chart-container">
        {isLoading && (
          <div className="chart-loading-overlay">
            <div className="chart-loading-spinner"></div>
            <span>Loading chart data...</span>
          </div>
        )}
        {!isLoading && (!data || data.length === 0) && (
          <div className="chart-empty-state">
            <span className="chart-empty-icon">📊</span>
            <p>No chart data available</p>
            <p className="chart-empty-hint">Historical data may be loading...</p>
          </div>
        )}
        <div
          ref={chartContainerRef}
          className="candlestick-chart-area"
          style={{ visibility: isLoading || !data || data.length === 0 ? 'hidden' : 'visible' }}
        />
      </div>
    </div>
  )
}
