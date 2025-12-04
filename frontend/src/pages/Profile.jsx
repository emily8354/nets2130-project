import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

export default function Profile({ user, onLogout, onUnitChange, unit, stravaConnected, onConnectionChange }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [myTeams, setMyTeams] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(true);

  const handleDisconnectStrava = async () => {
    if (!confirm('Disconnect your Strava account?')) return;
    setDisconnecting(true);
    try {
      const idParam = user?.id ? `userId=${user.id}` : `username=${encodeURIComponent(user.username)}`;
      const headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        // ignore
      }

      const res = await fetch(`${API_BASE}/api/strava/disconnect?${idParam}`, { headers });
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
      let headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        // ignore
      }

      const idParam = user?.id ? `userId=${user.id}` : `username=${user.username}`;
      const res = await fetch(`${API_BASE}/api/strava/auth?${idParam}`, { headers });
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

  const loadMyTeams = async () => {
    if (!user) return;
    setLoadingTeams(true);
    try {
      const headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        console.error('Error getting session:', err);
      }

      const res = await fetch(`${API_BASE}/api/teams`, { headers });
      if (res.ok) {
        const data = await res.json();
        // Find teams user is a member of
        const userTeams = (data.teams || []).filter(team => 
          team.members?.some(member => member.user_id === user?.id)
        );
        setMyTeams(userTeams);
      }
    } catch (err) {
      console.error('Error loading teams:', err);
    } finally {
      setLoadingTeams(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadMyTeams();
    }
  }, [user]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <h2>Profile</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        {/* Left Column: Account Info */}
        <div className="card">
          <h3>Account</h3>
          <p><strong>Username:</strong> {user.username}</p>
          {user.city && (
            <p><strong>Location:</strong> 📍 {user.city}</p>
          )}
          {user.streak !== undefined && (
            <p><strong>Current Streak:</strong> 🔥 {user.streak} days</p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
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

        {/* Right Column: Teams */}
        <div className="card">
          <h3>Teams</h3>
          {loadingTeams ? (
            <p className="small">Loading teams...</p>
          ) : myTeams.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {myTeams.map((team) => {
                const isOwner = team.members?.some(member => member.user_id === user?.id && member.role === 'owner');
                return (
                  <li key={team.id} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                    <strong>{team.name}</strong>
                    {isOwner && <span style={{ marginLeft: '0.5rem', color: '#8b5cf6', fontSize: '0.875rem' }}>👑 Owner</span>}
                    {team.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {team.city}</span>}
                    {team.description && <p className="small" style={{ marginTop: '0.5rem', marginBottom: 0, color: '#666' }}>{team.description}</p>}
                    <p className="small" style={{ marginTop: '0.25rem', marginBottom: 0, color: '#666' }}>
                      {team.members?.length || 0} member{team.members?.length !== 1 ? 's' : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small">Not a member of any teams yet. <a href="/teams" style={{ color: '#8b5cf6' }}>Join or create a team</a>.</p>
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
