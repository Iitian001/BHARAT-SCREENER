import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

const formatVolume = (volume) => {
  if (volume >= 10000000) return `${(volume / 10000000).toFixed(2)} Cr`
  if (volume >= 100000) return `${(volume / 100000).toFixed(2)} L`
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)} K`
  return volume.toString()
}

const SECTORS = ['All', 'Energy', 'IT Services', 'Banking', 'Banking (PSU)', 'FMCG', 'Telecom', 'Conglomerate', 'Infrastructure', 'Stock']
const SORT_OPTIONS = ['Market Cap', 'Price ↑', 'Price ↓', 'Change % ↑', 'Change % ↓', 'Volume']

// Use IST directly without double-offset
function getISTTime() {
  const now = new Date()
  // The browser is already in IST, so just use local time
  return now
}

function formatISTDate(date) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function formatISTTime(date) {
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase()
}

function MiniChart({ history, isPositive }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || history.length < 2) return
    const c = ref.current, ctx = c.getContext('2d')
    const w = 130, h = 36
    c.width = w * 2; c.height = h * 2; ctx.scale(2, 2)
    const prices = history.map(p => p.value)
    const mn = Math.min(...prices), mx = Math.max(...prices), r = mx - mn || 1
    ctx.clearRect(0, 0, w, h)

    // Draw candlestick-style bars
    const barW = Math.max(2, (w / prices.length) - 1)
    prices.forEach((p, i) => {
      const prev = i > 0 ? prices[i - 1] : p
      const x = (i / prices.length) * w
      const top = h - ((Math.max(p, prev) - mn) / r) * (h - 6) - 3
      const bot = h - ((Math.min(p, prev) - mn) / r) * (h - 6) - 3
      const bh = Math.max(2, bot - top)
      ctx.fillStyle = p >= prev ? '#22c55e' : '#ef4444'
      ctx.fillRect(x, top, barW, bh)
    })
  }, [history, isPositive])
  return <canvas ref={ref} style={{ width: '130px', height: '36px' }} />
}

export default function Dashboard({ stocks, indices, marketOpen, connected, priceHistory, prevPrices = {}, alerts = [] }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sectorFilter, setSectorFilter] = useState('All')
  const [sortBy, setSortBy] = useState('Market Cap')
  const [tab, setTab] = useState('LIVE STOCKS')
  const [viewMode, setViewMode] = useState('table') // 'table' or 'heatmap'
  const [currentTime, setCurrentTime] = useState(getISTTime())

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getISTTime()), 1000)
    return () => clearInterval(interval)
  }, [])

  const dateStr = formatISTDate(currentTime)
  const timeStr = formatISTTime(currentTime)

  const filteredStocks = useMemo(() => {
    let list = [...stocks]
    if (search) {
      const q = search.toUpperCase()
      list = list.filter(s => s.symbol.includes(q) || (s.name && s.name.toUpperCase().includes(q)))
    }
    if (sectorFilter !== 'All') {
      list = list.filter(s => (s.sector || 'Stock') === sectorFilter)
    }
    switch (sortBy) {
      case 'Price ↑': list.sort((a, b) => a.price - b.price); break
      case 'Price ↓': list.sort((a, b) => b.price - a.price); break
      case 'Change % ↑': list.sort((a, b) => a.changePercent - b.changePercent); break
      case 'Change % ↓': list.sort((a, b) => b.changePercent - a.changePercent); break
      case 'Volume': list.sort((a, b) => b.volume - a.volume); break
      default: list.sort((a, b) => b.price * b.volume - a.price * a.volume); break
    }
    return list
  }, [stocks, search, sectorFilter, sortBy])

  const idxData = [
    { name: 'NIFTY 50', val: indices.nifty50 || 22500 },
    { name: 'SENSEX', val: indices.sensex || 74000 },
    { name: 'NIFTY BANK', val: indices.bankNifty || 48000 }
  ]

  return (
    <div className="screener">
      {/* Top Bar */}
      <div className="screener-topbar">
        <div className="topbar-left">
          <img src="/logo.png" alt="Bharat Screener" className="topbar-logo-img" />
          <span className="screener-logo">BHARAT SCREENER</span>
          <div className="topbar-exchanges">
            <span className="topbar-exchange active">NSE</span>
            <span className="topbar-divider">|</span>
            <span className="topbar-exchange">BSE</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`topbar-status ${marketOpen ? 'open' : 'closed'}`}>
            MARKET STATUS: {marketOpen ? 'OPEN' : 'CLOSED'}
            <span className={`topbar-dot ${marketOpen ? 'dot-green' : 'dot-red'}`}></span>
          </span>
          <span className={`topbar-conn ${connected ? 'conn-live' : 'conn-off'}`}>
            CONNECTION: {connected ? 'LIVE' : 'OFFLINE'}
            <span className={`topbar-dot ${connected ? 'dot-green' : 'dot-red'}`}></span>
          </span>
          <span className="topbar-datetime">
            <span className="topbar-date">{dateStr}</span>
            <span className="topbar-time">{timeStr} IST</span>
          </span>
        </div>
      </div>

      {/* Ticker Tape */}
      <div className="ticker-tape">
        <div className="ticker-scroll">
          {stocks.slice(0, 50).concat(stocks.slice(0, 50)).map((s, i) => (
            <span key={i} className="ticker-item">
              <span className="ticker-sym">{s.symbol}</span>
              <span className="ticker-price">{Number(s.price).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
              <span className={`ticker-chg ${s.changePercent >= 0 ? 'positive' : 'negative'}`}>
                {s.changePercent >= 0 ? '▲' : '▼'} {Math.abs(s.change).toFixed(2)} ({Math.abs(s.changePercent).toFixed(2)}%)
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Index Cards Row */}
      <div className="idx-row">
        {idxData.map((idx, i) => {
          const chg = ((Math.random() - 0.4) * 200).toFixed(2)
          const chgPct = (chg / idx.val * 100).toFixed(2)
          const pos = parseFloat(chg) >= 0
          const o = (idx.val * (1 - Math.random() * 0.005)).toFixed(2)
          const h = (idx.val * (1 + Math.random() * 0.003)).toFixed(2)
          const l = (idx.val * (1 - Math.random() * 0.003)).toFixed(2)
          return (
            <div key={i} className="idx-card">
              <div className="idx-name">{idx.name}</div>
              <div className="idx-val">
                <span className={`idx-bars ${pos ? 'bars-green' : 'bars-red'}`}>▐▐</span>
                {idx.val.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}
              </div>
              <div className={`idx-change ${pos ? 'positive' : 'negative'}`}>
                {pos ? '▲' : '▼'} {Math.abs(chg)} ({Math.abs(chgPct)}%)
              </div>
              <div className="idx-ohlc">
                <span>O {Number(o).toLocaleString('en-IN')}</span>
                <span>H {Number(h).toLocaleString('en-IN')}</span>
                <span>L {Number(l).toLocaleString('en-IN')}</span>
              </div>
            </div>
          )
        })}
        <div className="idx-card idx-search-card">
          <div className="idx-search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="Search stocks (e.g. RELIANCE, TCS)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="screener-search"
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="robo-btn" onClick={() => navigate('/portfolio')} style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <span className="robo-icon">🤖</span> AI Robo-Advisor
            </button>
            <button className="robo-btn" onClick={() => navigate('/holdings')} style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
              <span className="robo-icon">💼</span> My Holdings
            </button>
          </div>
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="screener-controls">
        <div className="screener-tabs">
          {['LIVE STOCKS', 'SCREENS'].map(t => (
            <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
          <span className="tab-count">Showing top {Math.min(filteredStocks.length, 150)} of {filteredStocks.length}</span>
          <div className="view-mode-toggle" style={{marginLeft: '20px', display: 'flex', gap: '5px'}}>
            <button className={`tab-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>Table</button>
            <button className={`tab-btn ${viewMode === 'heatmap' ? 'active' : ''}`} onClick={() => setViewMode('heatmap')}>Heatmap</button>
          </div>
        </div>
        <div className="screener-filters">
          <select className="filter-select" value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}>
            {SECTORS.map(s => <option key={s} value={s}>SECTOR: {s.toUpperCase()}</option>)}
          </select>
          <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(s => <option key={s} value={s}>SORT: {s.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      {/* Data View */}
      {viewMode === 'table' ? (
        <div className="screener-table-wrap">
          <table className="screener-table">
            <thead>
              <tr>
                <th>#</th>
                <th>SYMBOL</th>
                <th>COMPANY</th>
                <th>SECTOR</th>
                <th className="th-right">LAST PRICE (₹)</th>
                <th>CHANGE</th>
                <th>CHANGE (%)</th>
                <th>DAY'S RANGE</th>
                <th className="th-right">VOLUME</th>
                <th>DAY CHART (INTRADAY)</th>
              </tr>
            </thead>
            <tbody>
              {filteredStocks.slice(0, 150).map((s, i) => {
                const pos = s.change >= 0
                const prev = prevPrices[s.symbol]
                let flashClass = ''
                if (prev && s.price > prev) flashClass = 'flash-up'
                else if (prev && s.price < prev) flashClass = 'flash-down'
                
                return (
                  <tr key={s.symbol} className={`screener-row ${i % 2 === 0 ? 'row-even' : 'row-odd'}`} onClick={() => navigate(`/stock/${s.symbol}`)}>
                    <td className="col-num">{i + 1}</td>
                    <td className="col-sym">{s.symbol}</td>
                    <td className="col-name">{s.name || s.symbol}</td>
                    <td className="col-sector">{s.sector || 'Stock'}</td>
                    <td className={`col-price ${flashClass}`}>{Number(s.price).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td className={`col-chg ${pos ? 'positive' : 'negative'}`}>
                      {pos ? '▲' : '▼'} {Math.abs(s.change).toFixed(2)}
                    </td>
                    <td className={`col-chgpct ${pos ? 'positive' : 'negative'}`}>
                      {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
                    </td>
                    <td className="col-range">
                      {Number(s.low).toLocaleString('en-IN', {minimumFractionDigits:2})} - {Number(s.high).toLocaleString('en-IN', {minimumFractionDigits:2})}
                    </td>
                    <td className="col-vol">{formatVolume(s.volume)}</td>
                    <td className="col-chart">
                      <MiniChart history={priceHistory[s.symbol] || []} isPositive={pos} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="heatmap-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '20px' }}>
          {filteredStocks.slice(0, 150).map(s => {
            const isPos = s.changePercent >= 0;
            const intensity = Math.min(Math.abs(s.changePercent) / 5, 1);
            const bgColor = isPos 
              ? `rgba(34, 197, 94, ${Math.max(0.2, intensity)})` 
              : `rgba(239, 68, 68, ${Math.max(0.2, intensity)})`;
              
            return (
              <div key={s.symbol} onClick={() => navigate(`/stock/${s.symbol}`)} style={{
                backgroundColor: bgColor,
                color: '#fff',
                padding: '15px',
                borderRadius: '8px',
                flex: '1 1 120px',
                minWidth: '120px',
                minHeight: '80px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.1)'
              }}
              onMouseOver={e => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div style={{fontWeight: 'bold', fontSize: '1.1rem'}}>{s.symbol}</div>
                <div style={{fontSize: '0.9rem'}}>{isPos ? '+' : ''}{s.changePercent.toFixed(2)}%</div>
                <div style={{fontSize: '0.8rem', opacity: 0.8}}>₹{s.price.toLocaleString('en-IN', {minimumFractionDigits:2})}</div>
              </div>
            )
          })}
        </div>
      )}


        {stocks.length === 0 && (
          <div className="screener-loading">
            <div className="loading-skeleton">
              <div className="skel-text">LOADING STOCKS...</div>
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="skel-row">
                  {[1,2,3,4,5,6,7,8].map(j => <div key={j} className="skel-block" style={{width: `${40 + Math.random() * 80}px`}}></div>)}
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Footer */}
      <div className="screener-footer">
        <span>DATA AS OF {dateStr} {timeStr} IST</span>
        <span>PRICES DELAYED BY 15 SECS</span>
        <span>© BHARAT SCREENER {currentTime.getFullYear()}</span>
      </div>

    </div>
  )
}
