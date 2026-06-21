import React, { useState } from 'react';

export default function SettingsModal({ onClose }) {
  const [apiKey, setApiKey] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [password, setPassword] = useState('');
  const [totpKey, setTotpKey] = useState(localStorage.getItem('angelOneTotp') || 'XL6PBE3HLAGDQ4MKSH47M5LZHQ');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('http://localhost:8080/api/settings/angel-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, clientCode, password, totpKey })
      });
      const data = await res.json();
      if (data.success) {
        setMessage('Settings saved successfully!');
        if (totpKey) localStorage.setItem('angelOneTotp', totpKey);
        setTimeout(() => onClose(), 1500);
      } else {
        setMessage(data.error || 'Failed to save settings');
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>⚙️ Angel One Integration</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <p className="modal-subtitle">Connect your Angel One account for real-time websocket data and live trading predictions.</p>
        
        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label>API Key (SmartAPI)</label>
            <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter SmartAPI Key" />
          </div>
          <div className="form-group">
            <label>Client Code</label>
            <input type="text" value={clientCode} onChange={e => setClientCode(e.target.value)} placeholder="e.g. AB1234" />
          </div>
          <div className="form-group">
            <label>Password (PIN)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter PIN/Password" />
          </div>
          <div className="form-group">
            <label>TOTP Key</label>
            <input type="text" value={totpKey} onChange={e => setTotpKey(e.target.value)} placeholder="Enter Auth App TOTP Key" />
          </div>
          
          {message && <div className={`form-message ${message.includes('success') ? 'success' : 'error'}`}>{message}</div>}
          
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>

        <style>{`
          .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            backdrop-filter: blur(4px);
          }
          .modal-content {
            background: #1e293b;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            width: 100%;
            max-width: 500px;
            padding: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            animation: modalIn 0.3s ease-out forwards;
          }
          @keyframes modalIn {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          }
          .modal-header h2 {
            margin: 0;
            font-size: 1.5rem;
            color: #f8fafc;
          }
          .close-btn {
            background: none;
            border: none;
            color: #94a3b8;
            font-size: 1.8rem;
            cursor: pointer;
            padding: 0;
            line-height: 1;
          }
          .close-btn:hover { color: #f8fafc; }
          .modal-subtitle {
            color: #94a3b8;
            font-size: 0.95rem;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .settings-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .form-group label {
            font-size: 0.9rem;
            font-weight: 500;
            color: #cbd5e1;
          }
          .form-group input {
            background: #0f172a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px 16px;
            color: white;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.2s;
          }
          .form-group input:focus {
            border-color: #3b82f6;
          }
          .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 16px;
          }
          .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: background 0.2s;
          }
          .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
          .btn-primary {
            background: #3b82f6;
            border: none;
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: background 0.2s;
          }
          .btn-primary:hover { background: #2563eb; }
          .btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }
          .form-message {
            padding: 12px;
            border-radius: 8px;
            font-size: 0.95rem;
          }
          .form-message.success { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); color: #4ade80; }
          .form-message.error { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; }
        `}</style>
      </div>
    </div>
  );
}
