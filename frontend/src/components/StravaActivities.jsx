import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

function StravaActivities({ user, unit = 'km' }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [connected, setConnected] = useState(false);
  const [importing, setImporting] = useState({});
  const [importingAll, setImportingAll] = useState(false);

  // Check connection status first
  useEffect(() => {
    if (user) {
      checkConnection();
    }
  }, [user]);

  const checkConnection = async () => {
    try {
      // Prefer Supabase user id when available; fallback to legacy username
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
      setConnected(status.connected);
      if (status.connected) {
        fetchActivities();
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Error checking connection:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connected && user) {
      fetchActivities();
    }
  }, [connected, user, page]);

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      // Prefer Supabase user id when available; fallback to legacy username
      const idParam = user?.id ? `userId=${user.id}` : `username=${encodeURIComponent(user.username)}`;
      const headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        // ignore
      }

      const response = await fetch(
        `${API_BASE}/api/strava/activities?${idParam}&per_page=10&page=${page}&excludeImported=true`,
        { headers }
      );

      if (response.status === 401) {
        setError('Strava authorization failed. Please reconnect your account.');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch activities');
      }

      const data = await response.json();
      if (page === 1) {
        setActivities(data);
      } else {
        setActivities((prev) => [...prev, ...data]);
      }

      setHasMore(data.length === 10);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching Strava activities:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const formatDistance = (meters) => {
    if (unit === 'mi') {
      const miles = meters / 1609.344;
      if (miles >= 1) return `${miles.toFixed(2)} mi`;
      return `${(miles * 5280).toFixed(0)} ft`;
    }
    // default: kilometers
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(0)} m`;
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getActivityTypeIcon = (type) => {
    const icons = {
      Run: '🏃',
      Ride: '🚴',
      Walk: '🚶',
      Swim: '🏊',
      Workout: '💪',
      Hike: '🥾',
    };
    return icons[type] || '🏃';
  };

  const handleImportActivity = async (stravaActivityId) => {
    setImporting({ ...importing, [stravaActivityId]: true });
    try {
      const headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        console.error('Error getting session:', err);
      }

      const response = await fetch(`${API_BASE}/api/activities/import-strava`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stravaActivityIds: [stravaActivityId]
        })
      });

      const data = await response.json();
      if (response.ok) {
        const pointsEarned = data.details?.imported?.[0]?.points || 0;
        alert(`Activity imported! You earned ${pointsEarned} points.`);
        // Remove the imported activity from the list
        setActivities(prev => prev.filter(a => a.id !== stravaActivityId));
        // Trigger refresh of "My Activities"
        window.dispatchEvent(new Event('activityImported'));
      } else {
        alert(data.error || 'Failed to import activity');
      }
    } catch (err) {
      console.error('Error importing activity:', err);
      alert('Error importing activity');
    } finally {
      setImporting({ ...importing, [stravaActivityId]: false });
    }
  };

  const handleImportAll = async () => {
    if (!confirm(`Import all ${activities.length} Strava activities? This will add them to your activity log and award points.`)) {
      return;
    }

    setImportingAll(true);
    try {
      const headers = {};
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (err) {
        console.error('Error getting session:', err);
      }

      const response = await fetch(`${API_BASE}/api/activities/import-strava`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          importAll: true
        })
      });

      const data = await response.json();
      if (response.ok) {
        alert(`Imported ${data.imported} activities! You earned points for ${data.imported} new activities.${data.skipped > 0 ? ` ${data.skipped} were already imported.` : ''}`);
        // Refresh activities list to remove imported ones
        setPage(1); // Reset to first page
        await fetchActivities();
        // Trigger refresh of "My Activities"
        window.dispatchEvent(new Event('activityImported'));
      } else {
        alert(data.error || 'Failed to import activities');
      }
    } catch (err) {
      console.error('Error importing all activities:', err);
      alert('Error importing activities');
    } finally {
      setImportingAll(false);
    }
  };

  if (!connected) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p className="small">Connect your Strava account to view your activities here.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (activities.length === 0 && !loading) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p>No activities found. Make sure you have activities in your Strava account.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3>Strava Activities</h3>
        {activities.length > 0 && (
          <button
            onClick={handleImportAll}
            disabled={importingAll}
            className="btn-primary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
          >
            {importingAll ? 'Importing...' : 'Add All'}
          </button>
        )}
      </div>
      {loading && activities.length === 0 ? (
        <p>Loading activities...</p>
      ) : (
        <>
          <div className="activities-list">
            {activities.map((activity) => (
              <div key={activity.id} className="activity-item" style={{ position: 'relative' }}>
                <div className="activity-header">
                  <span className="activity-icon">{getActivityTypeIcon(activity.type)}</span>
                  <div className="activity-info" style={{ flex: 1 }}>
                    <h4>{activity.name || activity.type}</h4>
                    <p className="small">{formatDate(activity.start_date_local)}</p>
                  </div>
                  <button
                    onClick={() => handleImportActivity(activity.id)}
                    disabled={importing[activity.id]}
                    className="btn-primary"
                    style={{ 
                      padding: '0.25rem 0.75rem', 
                      fontSize: '0.75rem',
                      marginLeft: '0.5rem'
                    }}
                  >
                    {importing[activity.id] ? 'Adding...' : 'Add'}
                  </button>
                </div>
                <div className="activity-stats">
                  {activity.distance > 0 && (
                    <div className="stat">
                      <span className="stat-label">Distance</span>
                      <span className="stat-value">{formatDistance(activity.distance)}</span>
                    </div>
                  )}
                  {activity.moving_time > 0 && (
                    <div className="stat">
                      <span className="stat-label">Time</span>
                      <span className="stat-value">{formatDuration(activity.moving_time)}</span>
                    </div>
                  )}
                  {activity.total_elevation_gain > 0 && (
                    <div className="stat">
                      <span className="stat-label">Elevation</span>
                      <span className="stat-value">{Math.round(activity.total_elevation_gain)} m</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={loading}
              className="load-more-btn"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default StravaActivities;

