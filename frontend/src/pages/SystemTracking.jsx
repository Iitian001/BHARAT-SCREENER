import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './SystemTracking.css';

const API_BASE = 'http://localhost:8080';

export default function SystemTracking() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [rejections, setRejections] = useState([]);
  const [dataHealth, setDataHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminActionStatus, setAdminActionStatus] = useState('');

  const fetchData = async () => {
    try {
      const [dashRes, rejRes, healthRes] = await Promise.all([
        fetch(`${API_BASE}/api/tracking/dashboard`),
        fetch(`${API_BASE}/api/portfolio/rejections`),
        fetch(`${API_BASE}/api/data/health`)
      ]);
      const dashData = await dashRes.json();
      const rejData = await rejRes.json();
      const healthData = await healthRes.json();

      if (dashData.success) setDashboard(dashData);
      if (rejData.success) setRejections(rejData.data);
      if (healthData.success) setDataHealth(healthData);
    } catch (err) {
      console.error("Failed to fetch tracking data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Live poll every 5s
    return () => clearInterval(interval);
  }, []);

  const handleKillSwitch = async (action) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: `Manual admin ${action} from dashboard` })
      });
      const data = await res.json();
      if (data.success) {
        setAdminActionStatus(`System ${action} successful.`);
        setTimeout(() => setAdminActionStatus(''), 3000);
      }
    } catch (err) {
      setAdminActionStatus(`Failed to ${action} system.`);
    }
  };

  if (loading) {
    return <div className="tracking-page loader">Loading System Status...</div>;
  }

  // Determine System Status
  const isDanger = dashboard?.liveTotalResolved >= 10 && dashboard?.liveWinRate < 30;

  return (
    <div className="tracking-page fadeIn">
      <div className="detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back to Screener</span>
        </button>
      </div>

      <div className="tracking-header">
        <h1>System Command Center</h1>
        <p>Real-time analytics, risk controls, and automated portfolio guardrails.</p>
      </div>

      <div className="tracking-grid">
        {/* Core Metrics Card */}
        <div className="tracking-card metrics-card">
          <h2>Live Performance vs Baseline</h2>
          <div className="metrics-grid">
            <div className="metric-box">
              <span className="metric-label">Live Win Rate</span>
              <span className={`metric-value ${isDanger ? 'danger' : 'success'}`}>
                {dashboard?.liveTotalResolved > 0 ? `${dashboard.liveWinRate.toFixed(2)}%` : 'No Data'}
              </span>
              <span className="metric-sub">Across {dashboard?.liveTotalResolved} resolved trades</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Historical Backtest Return</span>
              <span className="metric-value neutral">
                {dashboard?.backtestAvgReturn ? `${dashboard.backtestAvgReturn.toFixed(2)}%` : 'N/A'}
              </span>
              <span className="metric-sub">Avg across {dashboard?.backtestRuns} runs</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Avg Max Drawdown</span>
              <span className="metric-value warning">
                {dashboard?.backtestAvgDrawdown ? `${dashboard.backtestAvgDrawdown.toFixed(2)}%` : 'N/A'}
              </span>
              <span className="metric-sub">Expected risk baseline</span>
            </div>
          </div>
        </div>

        {/* Security Controls */}
        <div className="tracking-card security-card">
          <h2>Admin Kill Switch</h2>
          <p>Manually halt all predictions and portfolio generations. The system also auto-halts if Live Win Rate drops below 30%.</p>
          
          <div className="kill-switch-controls">
            <button className="btn-halt" onClick={() => handleKillSwitch('halt')}>
              🛑 HALT SYSTEM
            </button>
            <button className="btn-resume" onClick={() => handleKillSwitch('resume')}>
              ▶️ RESUME SYSTEM
            </button>
          </div>
          {adminActionStatus && <div className="admin-status">{adminActionStatus}</div>}
        </div>

        {/* Data Health */}
        <div className="tracking-card health-card">
          <h2>Data Infrastructure Health</h2>
          <p className="health-msg">✅ {dataHealth?.message || 'Data is fully sanitized.'}</p>
          <div className="health-bar">
            <div className="health-fill" style={{width: '100%'}}></div>
          </div>
        </div>

        {/* Rejections Feed */}
        <div className="tracking-card rejections-card">
          <h2>Portfolio Rejections Log</h2>
          <p>Real-time audit of why the AI algorithm rejected specific stocks during portfolio generation.</p>
          <div className="rejections-list">
            {rejections.length > 0 ? rejections.map((rej) => (
              <div key={rej.id} className="rejection-item">
                <div className="rej-time">{new Date(rej.timestamp).toLocaleTimeString()}</div>
                <div className="rej-symbol">{rej.symbol}</div>
                <div className="rej-reason">{rej.reason}</div>
              </div>
            )) : (
              <div className="no-rejections">No recent rejections. Generate a portfolio to see logs.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
