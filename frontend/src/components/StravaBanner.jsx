import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

function StravaBanner({ user, onConnectionChange }) {
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (user) {
      fetchConnectionStatus();
    }
  }, [user]);

  const fetchConnectionStatus = async () => {
    try {
      const idParam = user?.id ? `userId=${user.id}` : `username=${user.username}`;
      const response = await fetch(`${API_BASE}/api/strava/status?${idParam}`);
      const status = await response.json();
      setConnectionStatus(status);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching connection status:', error);
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
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
      const response = await fetch(`${API_BASE}/api/strava/auth?${idParam}`, { headers });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (error) {
      console.error('Error initiating Strava connection:', error);
      alert('Failed to connect to Strava. Please try again.');
      setConnecting(false);
    }
  };

  // Don't show banner if connected, dismissed, or loading
  if (loading || connectionStatus?.connected || dismissed) {
    return null;
  }

  return (
    <div className="strava-banner">
      <div className="strava-banner-content">
        <p>Connect Strava to automatically sync your activities.</p>
        <button 
          className="btn-primary" 
          onClick={handleConnect} 
          disabled={connecting}
        >
          {connecting ? 'Connecting...' : 'Connect with Strava'}
        </button>
      </div>
      <button className="strava-banner-close" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

export default StravaBanner;

