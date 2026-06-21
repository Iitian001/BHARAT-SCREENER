import React from 'react'

/**
 * CompanyInfo — Company details with key metrics grid
 * - Market Cap, P/E, P/B, EPS, ROE, ROCE, Dividend Yield, Debt/Equity
 * - 52-Week High/Low, Book Value, Face Value
 * - Sector, Industry, Exchange
 * - About section + website link
 * - Indian number formatting (₹ Cr / L)
 */

// Format large numbers in Indian system (Crores / Lakhs)
const formatMarketCap = (value) => {
  if (!value && value !== 0) return '—'
  const num = Number(value)
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`
  if (num >= 1000) return `₹${(num / 1000).toFixed(2)} K`
  return `₹${num.toLocaleString('en-IN')}`
}

const formatINR = (value) => {
  if (!value && value !== 0) return '—'
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatPercent = (value) => {
  if (!value && value !== 0) return '—'
  return `${Number(value).toFixed(2)}%`
}

const formatNumber = (value) => {
  if (!value && value !== 0) return '—'
  return Number(value).toFixed(2)
}

export default function CompanyInfo({ company, isLoading }) {
  // Loading skeleton
  if (isLoading) {
    return (
      <div className="company-info">
        <div className="company-info-header">
          <h3>📊 Company Overview</h3>
        </div>
        <div className="metrics-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="metric-card">
              <div className="loading-skeleton skeleton-line short"></div>
              <div className="loading-skeleton skeleton-line"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // No data state
  if (!company) {
    return (
      <div className="company-info">
        <div className="company-info-header">
          <h3>📊 Company Overview</h3>
        </div>
        <div className="company-empty">
          <p>Company information not available</p>
        </div>
      </div>
    )
  }

  // Build metrics array for the grid
  const metrics = [
    {
      label: 'Market Cap',
      value: formatMarketCap(company.market_cap || company.marketCap),
      icon: '🏢',
    },
    {
      label: 'P/E Ratio',
      value: formatNumber(company.pe_ratio || company.peRatio || company.pe || company.PE),
      icon: '📈',
    },
    {
      label: 'P/B Ratio',
      value: formatNumber(company.pb_ratio || company.pbRatio || company.pb || company.PB),
      icon: '📗',
    },
    {
      label: 'EPS',
      value: formatINR(company.eps || company.EPS),
      icon: '💹',
    },
    {
      label: 'ROE',
      value: formatPercent(company.roe || company.ROE),
      icon: '📊',
    },
    {
      label: 'ROCE',
      value: formatPercent(company.roce || company.ROCE),
      icon: '📉',
    },
    {
      label: 'Dividend Yield',
      value: formatPercent(company.dividend_yield || company.dividendYield),
      icon: '💰',
    },
    {
      label: 'Debt/Equity',
      value: formatNumber(company.debt_equity || company.debtEquity || company.debtToEquity),
      icon: '⚖️',
    },
    {
      label: '52W High',
      value: formatINR(company.high_52w || company.high52 || company.yearHigh || company['52WeekHigh']),
      icon: '🔺',
      highlight: 'positive',
    },
    {
      label: '52W Low',
      value: formatINR(company.low_52w || company.low52 || company.yearLow || company['52WeekLow']),
      icon: '🔻',
      highlight: 'negative',
    },
    {
      label: 'Book Value',
      value: formatINR(company.book_value || company.bookValue),
      icon: '📕',
    },
    {
      label: 'Face Value',
      value: formatINR(company.face_value || company.faceValue),
      icon: '🏷️',
    },
  ]

  return (
    <div className="company-info">
      {/* Header */}
      <div className="company-info-header">
        <h3>📊 Company Overview</h3>
        <div className="company-tags">
          {(company.sector || company.industry) && (
            <span className="company-tag sector-tag">
              {company.sector || company.industry}
            </span>
          )}
          {company.industry && company.sector && company.industry !== company.sector && (
            <span className="company-tag industry-tag">
              {company.industry}
            </span>
          )}
          {company.exchange && (
            <span className="company-tag exchange-tag">
              {company.exchange}
            </span>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        {metrics.map((metric, i) => (
          <div key={i} className={`metric-card ${metric.highlight || ''}`}>
            <div className="metric-label">
              <span className="metric-icon">{metric.icon}</span>
              <span>{metric.label}</span>
            </div>
            <div className="metric-value">{metric.value}</div>
          </div>
        ))}
      </div>

      {/* About Section */}
      {company.about && (
        <div className="company-about">
          <h4>About</h4>
          <p className="company-description">{company.about}</p>
        </div>
      )}

      {/* Website */}
      {company.website && (
        <div className="company-website">
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="website-link">
            🌐 {company.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        </div>
      )}
    </div>
  )
}
