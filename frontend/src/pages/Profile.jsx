import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:4000';

export default function Profile({ user, onLogout, onUnitChange, unit, stravaConnected, onConnectionChange }) {
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnectStrava = async () => {
    if (!confirm('Disconnect your Strava account?')) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`${API_BASE}/api/strava/disconnect?username=${user.username}`);
      if (res.ok) {
        alert('Strava disconnected');
        if (onConnectionChange) onConnectionChange();
      } else {
        alert('Failed to disconnect Strava');
      }
    } catch (err) {
      console.error(err);
      alert('Error disconnecting Strava');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleLogout = () => {
    // Simple frontend logout: clear local state and call parent handler
    if (onLogout) onLogout();
  };

  const toggleUnit = (e) => {
    const next = e.target.value;
    if (onUnitChange) onUnitChange(next);
  };

  const handleConnectStrava = async () => {
    // Initiate the OAuth flow via backend; backend returns an authUrl to redirect to
    try {
      const res = await fetch(`${API_BASE}/api/strava/auth?username=${user.username}`);
      const data = await res.json();
      if (data.authUrl) {
        // Redirect browser to Strava auth
        window.location.href = data.authUrl;
      } else {
        alert('Failed to start Strava connection');
      }
    } catch (err) {
      console.error('Error starting Strava auth', err);
      alert('Error starting Strava connection');
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1rem' }}>
      <h2>Profile</h2>
      <div className="card">
        <h3>Account</h3>
        <p><strong>Username:</strong> {user.username}</p>
        <p><strong>Team:</strong> {user.teamId}</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleLogout} className="btn-secondary">Log out</button>
          {stravaConnected ? (
            <button onClick={handleDisconnectStrava} className="disconnect-btn" disabled={disconnecting}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect Strava'}
            </button>
          ) : (
            <button onClick={handleConnectStrava} className="strava-connect-btn">Connect with Strava</button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Settings</h3>
        <label>
          Distance unit
          <select value={unit} onChange={toggleUnit}>
            <option value="km">Kilometers (km)</option>
            <option value="mi">Miles (mi)</option>
          </select>
        </label>
        <p className="small">Your preference is saved locally in your browser.</p>
      </div>
    </div>
  );
}
