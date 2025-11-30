import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

function StravaConnection({ user, onConnectionChange }) {
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [athlete, setAthlete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (user) {
      fetchConnectionStatus();
    }
  }, [user]);

  const fetchConnectionStatus = async () => {
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

      const response = await fetch(`${API_BASE}/api/strava/status?${idParam}`, { headers });
      const status = await response.json();
      setConnectionStatus(status);

      if (status.connected) {
        fetchAthleteProfile();
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Error fetching connection status:', error);
      setLoading(false);
    }
  };

  const fetchAthleteProfile = async () => {
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

      const response = await fetch(`${API_BASE}/api/strava/athlete?${idParam}`, { headers });
      if (response.ok) {
        const athleteData = await response.json();
        setAthlete(athleteData);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching athlete profile:', error);
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // If the user is authenticated via Supabase, include the access token so the server
      // can associate the Strava state with the Supabase user id (preferred).
      let headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        // ignore - proceed without token (legacy username flow)
      }

      const response = await fetch(`${API_BASE}/api/strava/auth?username=${user.username}`, { headers });
      const data = await response.json();
      if (data.authUrl) {
        // Redirect to Strava authorization
        window.location.href = data.authUrl;
      }
    } catch (error) {
      console.error('Error initiating Strava connection:', error);
      alert('Failed to connect to Strava. Please try again.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Strava account?')) {
      return;
    }

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

      const response = await fetch(`${API_BASE}/api/strava/disconnect?${idParam}`, { headers });
      if (response.ok) {
        setConnectionStatus({ connected: false });
        setAthlete(null);
        if (onConnectionChange) {
          onConnectionChange();
        }
      }
    } catch (error) {
      console.error('Error disconnecting Strava:', error);
      alert('Failed to disconnect Strava account.');
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h3>Strava Connection</h3>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Strava Connection</h3>
      {connectionStatus?.connected ? (
        <div className="strava-connected">
          {athlete && (
            <div className="athlete-info">
              {athlete.profile && (
                <img
                  src={athlete.profile}
                  alt={athlete.firstname}
                  className="athlete-avatar"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
              <div className="athlete-details">
                <h4>
                  {athlete.firstname} {athlete.lastname}
                </h4>
                <p className="small">
                  {athlete.city && `${athlete.city}, `}
                  {athlete.country}
                </p>
                {connectionStatus.isExpired && (
                  <p className="warning small">⚠️ Token expired - will refresh automatically</p>
                )}
              </div>
            </div>
          )}
          <button onClick={handleDisconnect} className="disconnect-btn">
            Disconnect Strava
          </button>
        </div>
      ) : (
        <div className="strava-disconnected">
          <p>Connect your Strava account to automatically sync your activities!</p>
          <button onClick={handleConnect} disabled={connecting} className="strava-connect-btn">
            {connecting ? 'Connecting...' : 'Connect with Strava'}
          </button>
        </div>
      )}
    </div>
  );
}

export default StravaConnection;

