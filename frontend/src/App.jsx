import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import PortfolioBuilder from './pages/PortfolioBuilder'
import Holdings from './pages/Holdings'

const WS_URL = 'ws://localhost:8080'

/**
 * App — Root component with BrowserRouter
 * - WebSocket connection at App level for live data
 * - Routes: / → Dashboard, /stock/:symbol → StockDetail
 * - Passes live stock data, indices, market status down to Dashboard
 */
function App() {
  const [stocks, setStocks] = useState([])
  const [prevPrices, setPrevPrices] = useState({})
  const [alerts, setAlerts] = useState([])
  const [connected, setConnected] = useState(false)
  const [priceHistory, setPriceHistory] = useState({})
  const [marketOpen, setMarketOpen] = useState(false)
  const [indices, setIndices] = useState({ nifty50: 22500, sensex: 74000, bankNifty: 48000 })
  const wsRef = useRef(null)

  // WebSocket connection — shared across all pages
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(WS_URL)

      wsRef.current.onopen = () => {
        setConnected(true)
        console.log('Connected to WebSocket')
      }

      wsRef.current.onclose = () => {
        setConnected(false)
        console.log('Disconnected from WebSocket')
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      wsRef.current.onerror = (err) => {
        console.error('WebSocket error:', err)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'init' || message.type === 'update') {
            setStocks(currentStocks => {
              if (currentStocks && currentStocks.length > 0) {
                const newPrev = {}
                currentStocks.forEach(s => {
                  newPrev[s.symbol] = s.price
                })
                setPrevPrices(newPrev)
              }
              return message.data
            })
            
            setMarketOpen(message.marketOpen)
            if (message.indices) {
              setIndices(message.indices)
            }

            // Update price history for sparklines efficiently
            setPriceHistory(prev => {
              const newHistory = { ...prev }
              const now = Date.now()
              const len = message.data.length
              
              for (let i = 0; i < len; i++) {
                const stock = message.data[i]
                let arr = newHistory[stock.symbol]
                
                if (!arr) {
                  arr = []
                  newHistory[stock.symbol] = arr
                } else {
                  // Mutate instead of reallocating for huge performance gain
                  arr = [...arr]
                  newHistory[stock.symbol] = arr
                }
                
                if (arr.length >= 50) {
                  arr.shift()
                }
                arr.push({ time: now, value: stock.price })
              }
              return newHistory
            })
          } else if (message.type === 'trade_alerts') {
            setAlerts(prev => [...message.data, ...prev].slice(0, 50)) // Keep last 50 alerts
            // Trigger browser notifications
            if (Notification.permission === 'granted') {
              message.data.forEach(alert => {
                new Notification(`⚡ Breakout: ${alert.symbol} at ₹${alert.price}`, {
                  body: alert.reason,
                  icon: '/favicon.ico' // Assuming a favicon exists
                });
              });
            }
          }
        } catch (err) {
          console.error('WebSocket message parse error:', err)
        }
      }
    }

    // Request notification permission on load
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null // Prevent reconnect on unmount
        wsRef.current.close()
      }
    }
  }, [])

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Dashboard stocks={stocks} indices={indices} marketOpen={marketOpen} connected={connected} priceHistory={priceHistory} prevPrices={prevPrices} alerts={alerts} />} />
          <Route path="/stock/:symbol" element={<StockDetail stocks={stocks} priceHistory={priceHistory} prevPrices={prevPrices} />} />
          <Route path="/portfolio" element={<PortfolioBuilder stocks={stocks} />} />
          <Route path="/holdings" element={<Holdings />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
