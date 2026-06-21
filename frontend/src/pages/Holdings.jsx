import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Holdings({ connected }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchHoldings();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchHoldings, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchHoldings = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/holdings');
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error('Error fetching holdings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async (holding) => {
    if (!window.confirm(`Are you sure you want to close position in ${holding.symbol}?`)) return;
    
    try {
      const res = await fetch(`http://localhost:8080/api/holdings/sell/${holding.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sell_price: holding.current_price })
      });
      const json = await res.json();
      if (json.success) {
        fetchHoldings();
      } else {
        alert('Error closing position: ' + json.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error closing position');
    }
  };

  if (loading && !data) {
    return (
      <div className="portfolio-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#fff' }}>
        <div className="loading-spinner"></div>
        <h2 style={{marginLeft: '20px'}}>Loading Holdings...</h2>
      </div>
    );
  }

  const { summary, openHoldings, closedHoldings } = data || { summary: {}, openHoldings: [], closedHoldings: [] };

  return (
    <div className="portfolio-container">
      <div className="portfolio-header">
        <div className="portfolio-title-group">
          <h1>My Holdings</h1>
          <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'LIVE MARKET' : 'OFFLINE'}
          </span>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back to Dashboard</button>
      </div>

      <div className="portfolio-summary-cards" style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
        <div className="summary-card" style={{ flex: 1, backgroundColor: 'rgba(18, 18, 26, 0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ color: '#888899', fontSize: '0.9rem', marginBottom: '8px' }}>Total Invested</div>
          <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 'bold' }}>₹{summary.totalInvested?.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
        </div>
        <div className="summary-card" style={{ flex: 1, backgroundColor: 'rgba(18, 18, 26, 0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ color: '#888899', fontSize: '0.9rem', marginBottom: '8px' }}>Current Value</div>
          <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 'bold' }}>₹{summary.currentValue?.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
        </div>
        <div className="summary-card" style={{ flex: 1, backgroundColor: 'rgba(18, 18, 26, 0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ color: '#888899', fontSize: '0.9rem', marginBottom: '8px' }}>Unrealized P&L</div>
          <div style={{ color: summary.totalUnrealizedPnl >= 0 ? '#22c55e' : '#ef4444', fontSize: '1.8rem', fontWeight: 'bold' }}>
            {summary.totalUnrealizedPnl >= 0 ? '+' : ''}₹{summary.totalUnrealizedPnl?.toLocaleString('en-IN', {maximumFractionDigits:2})}
            <span style={{ fontSize: '1rem', marginLeft: '10px' }}>
              ({summary.totalUnrealizedPnlPercent}%)
            </span>
          </div>
        </div>
      </div>

      <div className="portfolio-section" style={{ backgroundColor: 'rgba(18, 18, 26, 0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '30px' }}>
        <h2 style={{ marginBottom: '20px', color: '#fff' }}>Open Positions</h2>
        {openHoldings.length === 0 ? (
          <div style={{ color: '#888899', padding: '20px 0' }}>No open positions. Use the AI Portfolio Builder to allocate funds!</div>
        ) : (
          <table className="screener-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#888899', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: '12px' }}>Symbol</th>
                <th style={{ padding: '12px' }}>Quantity</th>
                <th style={{ padding: '12px' }}>Buy Price</th>
                <th style={{ padding: '12px' }}>LTP</th>
                <th style={{ padding: '12px' }}>Investment</th>
                <th style={{ padding: '12px' }}>Current Value</th>
                <th style={{ padding: '12px' }}>P&L</th>
                <th style={{ padding: '12px' }}>Stop Loss</th>
                <th style={{ padding: '12px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {openHoldings.map(h => {
                const isProfitable = h.unrealized_pnl >= 0;
                const hitStopLoss = h.current_price <= h.stop_loss;
                const hitTarget = h.current_price >= h.target_price;

                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', color: '#fff', fontWeight: 'bold' }}>
                      <span style={{ cursor: 'pointer', color: '#3b82f6' }} onClick={() => navigate(`/stock/${h.symbol}`)}>{h.symbol}</span>
                      {hitStopLoss && <span style={{ marginLeft: '10px', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>SL HIT</span>}
                      {hitTarget && <span style={{ marginLeft: '10px', backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>TARGET HIT</span>}
                    </td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>{h.quantity}</td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>₹{h.buy_price.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: '#fff', fontWeight: 'bold' }}>₹{h.current_price.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>₹{h.invested_amount.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>₹{h.current_value.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: isProfitable ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                      {isProfitable ? '+' : ''}₹{h.unrealized_pnl.toLocaleString('en-IN', {maximumFractionDigits:2})} ({h.unrealized_pnl_percent}%)
                    </td>
                    <td style={{ padding: '12px', color: '#ef4444' }}>₹{h.stop_loss.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px' }}>
                      <button 
                        style={{ backgroundColor: '#ef4444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        onClick={() => handleSell(h)}
                      >
                        CLOSE
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="portfolio-section" style={{ backgroundColor: 'rgba(18, 18, 26, 0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 style={{ marginBottom: '20px', color: '#fff' }}>Trade History (Closed)</h2>
        {closedHoldings.length === 0 ? (
          <div style={{ color: '#888899', padding: '20px 0' }}>No closed positions yet.</div>
        ) : (
          <table className="screener-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#888899', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: '12px' }}>Symbol</th>
                <th style={{ padding: '12px' }}>Quantity</th>
                <th style={{ padding: '12px' }}>Buy Price</th>
                <th style={{ padding: '12px' }}>Sell Price</th>
                <th style={{ padding: '12px' }}>Realized P&L</th>
                <th style={{ padding: '12px' }}>Close Date</th>
              </tr>
            </thead>
            <tbody>
              {closedHoldings.map(h => {
                const isProfitable = h.realized_pnl >= 0;
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '12px', color: '#fff', fontWeight: 'bold' }}>{h.symbol}</td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>{h.quantity}</td>
                    <td style={{ padding: '12px', color: '#e8e8f0' }}>₹{h.buy_price.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: '#fff' }}>₹{h.sell_price.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                    <td style={{ padding: '12px', color: isProfitable ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                      {isProfitable ? '+' : ''}₹{h.realized_pnl.toLocaleString('en-IN', {maximumFractionDigits:2})}
                    </td>
                    <td style={{ padding: '12px', color: '#888899' }}>{new Date(h.closed_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
